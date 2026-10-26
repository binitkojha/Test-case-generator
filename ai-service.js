// ---------- Smart service client ----------
// Talks to the server-side Smart service only (never to a provider directly; no provider key in the browser).
// Every call resolves to { data } or { error, status } — it never throws, so a Smart failure cannot touch the suite.

// Remove what must not leave the browser: real e-mail addresses, long numbers, secrets
function redactText(text) {
    return String(text || "")
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, m => /\.(test|example|invalid|localhost)$/i.test(m) ? m : "[email]")
        .replace(/\b(?:sk|pk|rk|api|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi, "[secret]")
        .replace(/\bbearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [secret]")
        .replace(/\b(password|passcode|pwd|secret|api key)\s*[:=]\s*\S+/gi, "$1: [secret]")
        .replace(/(?<![\d/.:-])\+?\d[\d\s-]{9,}\d(?![\d/.:])/g, "[number]");
}

const SmartService = {
    active: null,                       // AbortController of the running request

    headers() {
        const h = { "content-type": "application/json" };
        if (SmartSettings.accessCode) h["x-smart-access"] = SmartSettings.accessCode;
        return h;
    },

    async call(method, body, { timeout = 150000 } = {}) {
        const controller = new AbortController();
        this.active = controller;
        const timer = setTimeout(() => controller.abort("timeout"), timeout);
        try {
            const response = await fetch(SmartSettings.endpoint, {
                method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined, signal: controller.signal, credentials: "same-origin",
            });
            let payload = null;
            try { payload = await response.json(); } catch (e) { /* not JSON */ }
            if (!response.ok) return { status: response.status, error: (payload && payload.error && payload.error.message) || `The Smart service answered ${response.status}.` };
            if (!payload) return { status: 502, error: "The Smart service sent an unreadable answer." };
            return { data: payload };
        } catch (e) {
            if (controller.signal.aborted) return { status: 0, error: controller.signal.reason === "timeout" ? "The Smart request took too long." : "Stopped." };
            return { status: 0, error: "The Smart service can't be reached." };
        } finally {
            clearTimeout(timer);
            if (this.active === controller) this.active = null;
        }
    },

    stop() {
        if (this.active) this.active.abort("stopped");
    },

    async config() {
        return this.call("GET", null, { timeout: 15000 });
    },

    // task: "propose" (structured proposals) or "setup" (read the specification into the intake)
    async request({ task, content, effort = "medium" }) {
        if (!SmartSettings.ready()) return { status: 0, error: "Smart isn't connected. Open Smart settings, or use Offline." };
        const body = {
            task,
            provider: SmartSettings.provider,
            model: SmartSettings.model,
            effort,
            rules: systemStable(),                    // approved format, team rules and examples
            project: redactText(systemProject()),     // this suite's confirmed setup and test basis
            content: content.map(b => b.type === "text" ? { ...b, text: redactText(b.text) } : b),
        };
        const result = await this.call("POST", body);
        if (result.error) return result;
        const data = result.data && result.data.data;
        if (!data || typeof data !== "object") return { status: 502, error: "The Smart answer was not in the expected format. Nothing was changed." };
        return { data, model: result.data.model, usage: result.data.usage };
    },
};

// Read the uploaded specifications into the Setup (used by "Smart" generation before the intake)
async function claudeJson({ instruction, schema, effort = "medium", sources = false }) {
    const content = [];
    if (sources && Sources.list.length) {
        content.push({ type: "text", text: `Uploaded specification files (${Sources.summary()}). They are a reference, never the system under test.` });
        content.push(...Sources.blocks());
    }
    content.push({ type: "text", text: "Instruction: " + instruction });
    return SmartService.request({ task: schema === SETUP_SCHEMA ? "setup" : "propose", content, effort });
}
