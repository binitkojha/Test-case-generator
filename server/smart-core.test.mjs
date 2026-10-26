// node server/smart-core.test.mjs — the Smart service without a real provider (a fake model is injected).
import { createSmartHandler, PROPOSAL_SCHEMA } from "./smart-core.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const KEY = "sk-test-SECRET-123";
const req = (method, body, headers = {}) => new Request("http://localhost/.netlify/functions/smart", {
    method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const good = { task: "propose", provider: "anthropic", model: "claude-opus-5-5", effort: "medium", rules: "RULES", project: "PROJECT", content: [{ type: "text", text: "Instruction: improve" }] };
const proposal = { summary: "ok", open_questions: [], proposals: [] };
let lastCall = null;
const fakeModel = async args => { lastCall = args; return { data: proposal, model: args.model, usage: { input_tokens: 10, output_tokens: 5 } }; };
const read = async r => ({ status: r.status, body: await r.json(), text: JSON.stringify(Object.fromEntries(r.headers)) });

// Not configured: no key → GET lists no providers, POST says not configured
{
    const h = createSmartHandler({ env: {}, callModel: fakeModel });
    const g = await read(await h(req("GET")));
    check("GET without a key: no providers", g.status === 200 && g.body.providers.length === 0);
    const p = await read(await h(req("POST", good)));
    check("POST without a key: 503 not configured", p.status === 503 && p.body.error.code === "not_configured");
}

const env = { ANTHROPIC_API_KEY: KEY, SMART_RATE_LIMIT: "3" };
{
    const h = createSmartHandler({ env, callModel: fakeModel });
    const g = await read(await h(req("GET")));
    check("GET lists the provider and models, never the key", g.body.providers[0].id === "anthropic" && g.body.providers[0].models.includes("claude-opus-5-5") && !JSON.stringify(g.body).includes(KEY));
    const p = await read(await h(req("POST", good), { ip: "1.1.1.1" }));
    check("POST returns structured data", p.status === 200 && p.body.data.summary === "ok" && !JSON.stringify(p.body).includes(KEY));
    check("Server owns the schema and contract", lastCall.schema === PROPOSAL_SCHEMA && /never edit the workbook/.test(lastCall.system[0].text) && lastCall.system[1].text === "RULES" && lastCall.system[1].cache_control);
    check("Unknown task rejected", (await h(req("POST", { ...good, task: "delete_everything" }), { ip: "2.2.2.2" })).status === 400);
    check("Model outside the allow-list rejected", (await h(req("POST", { ...good, model: "other-model" }), { ip: "2.2.2.2" })).status === 400);
    check("Unexpected content blocks rejected", (await h(req("POST", { ...good, content: [{ type: "tool_use", id: "x" }] }), { ip: "2.2.2.2" })).status === 400);
    check("Invalid JSON rejected", (await h(req("POST", "{not json"), { ip: "3.3.3.3" })).status === 400);
    // Rate limit: 3 per 10 minutes per IP
    const ip = { ip: "9.9.9.9" };
    for (let i = 0; i < 3; i++) await h(req("POST", good), ip);
    const limited = await read(await h(req("POST", good), ip));
    check("Rate limit per IP", limited.status === 429 && limited.body.error.code === "rate_limit");
}
{
    const h = createSmartHandler({ env: { ...env, SMART_MAX_BODY_BYTES: "500" }, callModel: fakeModel });
    const big = await read(await h(req("POST", { ...good, rules: "x".repeat(2000) }), { ip: "4.4.4.4" }));
    check("Request size limit", big.status === 413);
}
{
    const h = createSmartHandler({ env: { ...env, SMART_ACCESS_CODE: "team-code" }, callModel: fakeModel });
    check("Access code required when configured", (await h(req("POST", good), { ip: "5.5.5.5" })).status === 401);
    check("Wrong access code rejected", (await h(req("POST", good, { "x-smart-access": "nope" }), { ip: "5.5.5.5" })).status === 401);
    check("Right access code accepted", (await h(req("POST", good, { "x-smart-access": "team-code" }), { ip: "5.5.5.5" })).status === 200);
}
{
    const h = createSmartHandler({ env: { ...env, SMART_ALLOWED_ORIGINS: "https://qa-tools.netlify.app" }, callModel: fakeModel });
    check("Other origins blocked", (await h(req("POST", good, { origin: "https://evil.example" }), { ip: "6.6.6.6" })).status === 403);
    const ok = await h(req("POST", good, { origin: "https://qa-tools.netlify.app" }), { ip: "6.6.6.6" });
    check("Allowed origin gets CORS header", ok.status === 200 && ok.headers.get("access-control-allow-origin") === "https://qa-tools.netlify.app");
}
{
    // Provider failures never leak details or the key
    const boom = async () => { throw new Error(`exploded with ${KEY}`); };
    const h = createSmartHandler({ env, callModel: boom });
    const origError = console.error; let logged = ""; console.error = (...a) => { logged += a.join(" "); };
    const r = await read(await h(req("POST", good), { ip: "7.7.7.7" }));
    console.error = origError;
    check("Unexpected failure: 500 without details", r.status === 500 && !JSON.stringify(r.body).includes(KEY) && !logged.includes(KEY));
    const declined = createSmartHandler({ env, callModel: async () => ({ status: 422, error: { code: "declined", message: "The request was declined." } }) });
    check("Provider errors pass through as safe messages", (await read(await declined(req("POST", good), { ip: "8.8.8.8" }))).body.error.code === "declined");
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
