// Smart service core — the only place that talks to the model provider.
// Runs server-side (Netlify Function or the local dev server). The provider key comes from environment
// variables and never reaches the browser, the logs or the workbook.
//
// Environment
//   ANTHROPIC_API_KEY       provider key (required for the "anthropic" provider)
//   SMART_MODELS            comma-separated allowed models (default: claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5)
//   SMART_ACCESS_CODE       optional shared access code; when set, requests need header  x-smart-access: <code>
//   SMART_ALLOWED_ORIGINS   optional comma-separated origins allowed to call the service
//   SMART_RATE_LIMIT        requests per IP per 10 minutes (default 30)
//   SMART_MAX_BODY_BYTES    request size limit (default 5 000 000)


const STR = { type: "string" };
const STR_LIST = { type: "array", items: STR };

// The response contract: proposals only — the app validates them and the tester approves them
export const PROPOSAL_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "proposals", "open_questions"],
    properties: {
        summary: STR,
        open_questions: STR_LIST,
        proposals: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["op", "target_uid", "module", "module_title", "fields", "test_data", "explanation", "sources", "assumptions"],
                properties: {
                    op: { type: "string", enum: ["add", "update", "delete", "suggest"] },
                    target_uid: STR,
                    module: STR,
                    module_title: STR,
                    fields: {
                        type: "object",
                        additionalProperties: false,
                        required: ["description", "importance", "pre", "data", "steps"],
                        properties: {
                            description: STR, importance: STR, pre: STR, data: STR,
                            steps: {
                                type: "array",
                                items: { type: "object", additionalProperties: false, required: ["action", "expected"], properties: { action: STR, expected: STR } },
                            },
                        },
                    },
                    test_data: {
                        type: "array",
                        items: {
                            type: "object", additionalProperties: false, required: ["category", "item", "value", "notes"],
                            properties: { category: STR, item: STR, value: STR, notes: STR },
                        },
                    },
                    explanation: STR,
                    sources: STR_LIST,
                    assumptions: STR_LIST,
                },
            },
        },
    },
};

// Reading the uploaded specifications into the intake (the tester confirms it before anything is written)
export const SETUP_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "project_name", "prefix", "file_name", "scope", "change_areas", "surfaces", "modules", "default_precondition", "test_data", "open_questions", "basis_notes"],
    properties: {
        summary: STR, project_name: STR, prefix: STR, file_name: STR,
        scope: { type: "string", enum: ["changed", "ui", "full"] },
        change_areas: { type: "array", items: { type: "object", additionalProperties: false, required: ["area", "type"], properties: { area: STR, type: { type: "string", enum: ["NEW", "EXISTING-REVAMPED"] } } } },
        surfaces: { type: "array", items: { type: "string", enum: ["Time Clock device", "Manager web", "Settings", "Reports", "Mobile app"] } },
        modules: { type: "array", items: { type: "object", additionalProperties: false, required: ["code", "name", "title"], properties: { code: STR, name: STR, title: STR } } },
        default_precondition: STR,
        test_data: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "item", "value", "notes"], properties: { category: STR, item: STR, value: STR, notes: STR } } },
        open_questions: STR_LIST,
        basis_notes: STR,
    },
};

const TASKS = { propose: PROPOSAL_SCHEMA, setup: SETUP_SCHEMA };

// Fixed by the server: the role and the response contract. The team's rules arrive with the request.
const CONTRACT = `You are the QA assistant inside the Test Case Generator. You never edit the workbook: you return proposals that the application validates and a tester approves.
Rules that cannot be relaxed:
- The system under test is the software application only. Uploaded documents are a specification reference: never write steps, descriptions or results about slides, figures, release notes or previous screens.
- Every description starts with "Verify". One action per step. Every expected result has exactly one sentence with "should". If the specification does not state a behaviour, start the expected result with "To confirm:" and never invent wording.
- Never set a status and never write an actual result — execution is recorded by testers with evidence.
- Test data is concrete and synthetic (names, PINs, job roles, dates, times). Every "Item: value" line in a case's data must exist in the Test Data or be added in the proposal's test_data.
- Use only the stable target_uid values you were given. Use "" for target_uid on add and suggest. Do not invent case IDs; the application numbers them.
- For update, leave a field as "" (or steps as []) to keep it unchanged. Keep within the scope you were given.
- Use op "suggest" for advice that is not a concrete change (missing coverage, duplicates, questions).`;

const DEFAULT_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function safeEqual(a, b) {
    const x = String(a || ""), y = String(b || "");
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
}

// Only the content block types the app sends
function validContent(content) {
    if (!Array.isArray(content) || !content.length || content.length > 400) return false;
    return content.every(b => b && typeof b === "object" && (
        (b.type === "text" && typeof b.text === "string") ||
        (b.type === "image" && b.source && b.source.type === "base64" && /^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type) && typeof b.source.data === "string") ||
        (b.type === "document" && b.source && ((b.source.type === "base64" && b.source.media_type === "application/pdf") || (b.source.type === "text" && b.source.media_type === "text/plain")) && typeof b.source.data === "string")
    ));
}

// The provider SDK is loaded on first use, so the service (and its tests) start without it
async function defaultCallModel({ apiKey, model, system, content, schema, effort, signal }) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    try {
        const stream = client.messages.stream({
            model,
            max_tokens: 16000,
            output_config: { effort, format: { type: "json_schema", schema } },
            system,
            messages: [{ role: "user", content }],
        }, { signal });
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") return { status: 422, error: { code: "declined", message: "The request was declined. Rephrase the command." } };
        if (message.stop_reason === "max_tokens") return { status: 422, error: { code: "too_long", message: "The answer was cut off. Narrow the scope (selected cases or one module)." } };
        const text = message.content.filter(b => b.type === "text").map(b => b.text).join("");
        return { data: JSON.parse(text), model: message.model, usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens } };
    } catch (e) {
        if (e instanceof SyntaxError) return { status: 502, error: { code: "bad_output", message: "The answer could not be read. Try again." } };
        if (e instanceof Anthropic.AuthenticationError) return { status: 502, error: { code: "provider_auth", message: "The server's provider key was rejected. Check the environment variable." } };
        if (e instanceof Anthropic.PermissionDeniedError) return { status: 502, error: { code: "provider_permission", message: "The server's provider key has no access to this model." } };
        if (e instanceof Anthropic.RateLimitError) return { status: 429, error: { code: "provider_rate_limit", message: "The provider is rate limiting. Wait a moment and try again." } };
        if (e instanceof Anthropic.BadRequestError) return { status: 400, error: { code: "provider_bad_request", message: "The provider rejected the request." } };
        if (e instanceof Anthropic.APIConnectionError) return { status: 503, error: { code: "provider_unreachable", message: "The provider could not be reached." } };
        if (e instanceof Anthropic.APIError) return { status: 502, error: { code: "provider_error", message: `Provider error ${e.status || ""}`.trim() } };
        if (e && e.name === "AbortError") return { status: 504, error: { code: "timeout", message: "The request took too long." } };
        throw e;
    }
}

export function createSmartHandler({ env = process.env, callModel = defaultCallModel, now = () => Date.now() } = {}) {
    const hits = new Map();                                   // best-effort per-instance rate limit
    const models = (env.SMART_MODELS || DEFAULT_MODELS.join(",")).split(",").map(s => s.trim()).filter(Boolean);
    const providers = () => env.ANTHROPIC_API_KEY ? [{ id: "anthropic", label: "Anthropic", models, default: models[0] }] : [];
    const limit = Number(env.SMART_RATE_LIMIT || 30);
    const maxBytes = Number(env.SMART_MAX_BODY_BYTES || 5000000);
    const origins = (env.SMART_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

    return async function handle(req, { ip = "unknown" } = {}) {
        const origin = req.headers.get("origin");
        if (origins.length && origin && !origins.includes(origin)) return json(403, { error: { code: "origin", message: "This site may not use the Smart service." } });
        const cors = origin && (!origins.length || origins.includes(origin)) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, x-smart-access" } });

        const authRequired = !!env.SMART_ACCESS_CODE;
        if (authRequired && !safeEqual(req.headers.get("x-smart-access"), env.SMART_ACCESS_CODE)) {
            return json(401, { error: { code: "unauthorized", message: "Enter the Smart access code in Smart settings." }, authRequired }, cors);
        }

        if (req.method === "GET") return json(200, { ok: true, providers: providers(), authRequired, limits: { maxBodyBytes: maxBytes, perTenMinutes: limit } }, cors);
        if (req.method !== "POST") return json(405, { error: { code: "method", message: "Use GET or POST." } }, cors);

        // Rate limit per IP: `limit` requests per 10 minutes
        const t = now();
        const recent = (hits.get(ip) || []).filter(x => t - x < 600000);
        if (recent.length >= limit) return json(429, { error: { code: "rate_limit", message: "Too many Smart requests. Try again in a few minutes." } }, { ...cors, "retry-after": "60" });
        recent.push(t);
        hits.set(ip, recent);

        const length = Number(req.headers.get("content-length") || 0);
        if (length > maxBytes) return json(413, { error: { code: "too_large", message: "The request is too large. Send fewer files or a smaller scope." } }, cors);
        let raw;
        try { raw = await req.text(); } catch (e) { return json(400, { error: { code: "body", message: "The request could not be read." } }, cors); }
        if (raw.length > maxBytes) return json(413, { error: { code: "too_large", message: "The request is too large. Send fewer files or a smaller scope." } }, cors);
        let body;
        try { body = JSON.parse(raw); } catch (e) { return json(400, { error: { code: "json", message: "The request is not valid JSON." } }, cors); }

        const schema = TASKS[body.task];
        if (!schema) return json(400, { error: { code: "task", message: "Unknown task." } }, cors);
        const provider = providers().find(p => p.id === (body.provider || "anthropic"));
        if (!provider) return json(503, { error: { code: "not_configured", message: "Smart is not configured on the server. Offline generation still works." } }, cors);
        const model = body.model || provider.default;
        if (!provider.models.includes(model)) return json(400, { error: { code: "model", message: "That model is not allowed on this server." } }, cors);
        if (!validContent(body.content)) return json(400, { error: { code: "content", message: "The request content is not in the expected format." } }, cors);
        const effort = ["low", "medium", "high"].includes(body.effort) ? body.effort : "medium";

        const system = [
            { type: "text", text: CONTRACT },
            { type: "text", text: String(body.rules || "").slice(0, 200000), cache_control: { type: "ephemeral" } },
            { type: "text", text: String(body.project || "").slice(0, 200000) || "(no project context)" },
        ];

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(env.SMART_TIMEOUT_MS || 120000));
        try {
            const result = await callModel({ apiKey: env.ANTHROPIC_API_KEY, model, system, content: body.content, schema, effort, signal: controller.signal });
            if (result.error) return json(result.status || 502, { error: result.error }, cors);
            return json(200, { data: result.data, model: result.model || model, usage: result.usage || null }, cors);
        } catch (e) {
            // Never echo provider details or the key
            console.error("smart: unexpected error", e && e.name);
            return json(500, { error: { code: "server", message: "The Smart service failed. Your suite was not changed." } }, cors);
        } finally {
            clearTimeout(timer);
        }
    };
}
