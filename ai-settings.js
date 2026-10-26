// ---------- Smart settings ----------
// Where the Smart service lives, which provider and model to use, and whether it is reachable.
// Only non-secret settings are kept in this browser. The provider key stays on the server; the optional
// access code is held in memory for this tab only.

const SMART_SETTINGS_KEY = "tcg-smart-settings";
const SMART_DEFAULT_ENDPOINT = "/.netlify/functions/smart";

const SmartSettings = {
    endpoint: SMART_DEFAULT_ENDPOINT,
    provider: "anthropic",
    model: "",
    accessCode: "",                 // memory only — never written to storage
    status: "unknown",              // unknown · checking · connected · not_configured · unauthorized · unavailable
    providers: [],
    authRequired: false,
    message: "",

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(SMART_SETTINGS_KEY)) || {};
            this.endpoint = saved.endpoint || SMART_DEFAULT_ENDPOINT;
            this.provider = saved.provider || "anthropic";
            this.model = saved.model || "";
        } catch (e) { /* defaults */ }
        // Earlier versions kept a provider key in this browser — remove it
        try { localStorage.removeItem("tcg-anthropic-key"); } catch (e) { /* ignore */ }
    },
    save() {
        try { localStorage.setItem(SMART_SETTINGS_KEY, JSON.stringify({ endpoint: this.endpoint, provider: this.provider, model: this.model })); } catch (e) { /* memory only */ }
    },

    ready() {
        return this.status === "connected";
    },

    statusText() {
        return {
            unknown: "Not checked yet",
            checking: "Checking the Smart service…",
            connected: `Connected · ${(this.providers.find(p => p.id === this.provider) || {}).label || this.provider} · ${this.model || "default model"}`,
            not_configured: "The Smart service has no provider key yet — Offline generation still works.",
            unauthorized: "The Smart service needs the team access code.",
            unavailable: "The Smart service can't be reached — Offline generation still works.",
        }[this.status] + (this.message && this.status !== "connected" ? ` (${this.message})` : "");
    },

    // Ask the service which providers and models it offers
    async test({ quiet = false } = {}) {
        this.status = "checking";
        this.render();
        const result = await SmartService.config();
        this.message = "";
        if (result.error) {
            this.status = result.status === 401 ? "unauthorized" : "unavailable";
            this.message = result.status === 401 ? "" : result.error;
            this.authRequired = result.status === 401 || this.authRequired;
        } else {
            this.providers = result.data.providers || [];
            this.authRequired = !!result.data.authRequired;
            const provider = this.providers.find(p => p.id === this.provider) || this.providers[0];
            if (!provider) {
                this.status = "not_configured";
            } else {
                this.provider = provider.id;
                if (!provider.models.includes(this.model)) this.model = provider.default || provider.models[0];
                this.status = "connected";
            }
        }
        this.render();
        if (typeof renderEngine === "function") renderEngine();
        if (typeof Chat !== "undefined" && Chat.input) Chat.renderMode();
        if (!quiet) App.toast(this.statusText());
        return this.ready();
    },

    open() {
        const box = $("chatSettings");
        box.hidden = false;
        this.render();
        $("smartEndpoint").focus();
    },

    render() {
        if (!$("smartEndpoint")) return;
        if (document.activeElement !== $("smartEndpoint")) $("smartEndpoint").value = this.endpoint;
        const providers = this.providers.length ? this.providers : [{ id: this.provider, label: this.provider === "anthropic" ? "Anthropic" : this.provider, models: this.model ? [this.model] : [] }];
        $("smartProvider").innerHTML = providers.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === this.provider ? "selected" : ""}>${escapeHtml(p.label || p.id)}</option>`).join("");
        const models = (providers.find(p => p.id === this.provider) || providers[0] || { models: [] }).models;
        $("smartModel").innerHTML = models.length
            ? models.map(m => `<option value="${escapeHtml(m)}" ${m === this.model ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")
            : `<option value="">Test the connection to load models</option>`;
        $("smartAccessRow").hidden = !this.authRequired;
        $("smartStatus").textContent = this.statusText();
        $("smartStatus").className = "smart-status " + (this.status === "connected" ? "ok" : this.status === "checking" || this.status === "unknown" ? "idle" : "warn");
        const conn = $("smartConn");
        if (conn) { conn.textContent = this.ready() ? "● Connected" : "● Not connected"; conn.className = "smart-conn " + (this.ready() ? "ok" : "warn"); }
    },

    init() {
        this.load();
        $("smartProvider").addEventListener("change", e => { this.provider = e.target.value; this.model = ""; this.render(); });
        $("smartModel").addEventListener("change", e => { this.model = e.target.value; });
        $("smartAccess").addEventListener("input", e => { this.accessCode = e.target.value; });
        $("smartTest").addEventListener("click", () => {
            this.endpoint = $("smartEndpoint").value.trim() || SMART_DEFAULT_ENDPOINT;
            this.test();
        });
        $("smartSave").addEventListener("click", async () => {
            this.endpoint = $("smartEndpoint").value.trim() || SMART_DEFAULT_ENDPOINT;
            this.save();
            await this.test({ quiet: true });
            $("chatSettings").hidden = true;
            App.toast(this.statusText());
        });
        this.render();
        // Check quietly when the app runs from a web server (not from a local file)
        if (/^https?:/.test(location.protocol) || /^https?:/.test(this.endpoint)) this.test({ quiet: true });
        else { this.status = "unavailable"; this.message = "open the app from a web server or Netlify to use Smart"; this.render(); }
    },
};
