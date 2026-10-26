// History: every test case suite is saved in this browser (IndexedDB) so it can be reopened and changed later.
// The latest state is auto-saved as you work; versions are checkpoints (generated, written with AI, imported, before clearing …).

const MAX_VERSIONS = 20;

const History = {
    lastSaved: null,

    db() {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open("tcg-history", 1);
                req.onupgradeneeded = () => req.result.createObjectStore("projects", { keyPath: "id" });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return this.dbPromise;
    },
    async run(mode, fn) {
        const db = await this.db();
        return new Promise((resolve, reject) => {
            const t = db.transaction("projects", mode);
            const req = fn(t.objectStore("projects"));
            t.oncomplete = () => resolve(req ? req.result : undefined);
            t.onerror = () => reject(t.error);
        });
    },
    all() { return this.run("readonly", s => s.getAll()).catch(() => []); },
    get(id) { return this.run("readonly", s => s.get(id)).catch(() => undefined); },
    put(entry) { return this.run("readwrite", s => s.put(entry)); },
    remove(id) { return this.run("readwrite", s => s.delete(id)); },

    // The project as stored: everything except the conversation and UI state
    snapshot() {
        const { chat, ai, tab, ...rest } = App.state;
        void chat; void ai; void tab;
        return JSON.parse(JSON.stringify(rest));
    },

    meta(state) {
        const sections = state.suite.sections;
        const stats = { total: 0, Pass: 0, Fail: 0, Blocked: 0 };
        sections.forEach(s => s.cases.forEach(c => { stats.total++; const st = caseStatus(c); if (st in stats) stats[st]++; }));
        return { cases: stats.total, stats, modules: sections.map(s => s.code) };
    },

    hasContent() {
        const s = App.state;
        return s.suite.sections.length > 0 || !!s.project.name.trim() || s.modules.some(m => m.code || m.scenarios.trim()) || !!(s.basisText || "").trim();
    },

    async save({ version = false, label = "" } = {}) {
        if (!this.hasContent()) return null;
        if (!App.state.projectId) App.state.projectId = newProjectId();
        const id = App.state.projectId;
        const now = Date.now();
        const state = this.snapshot();
        const meta = this.meta(state);
        const p = state.project;
        const entry = (await this.get(id)) || { id, createdAt: now, versions: [] };
        Object.assign(entry, {
            name: p.name.trim() || "Untitled suite",
            fileName: p.fileName || "",
            code: p.code || "",
            updatedAt: now,
            ...meta,
            state,
            sources: Sources.list.map(s => ({ ...s })),
        });
        if (version || !entry.versions.length) {
            entry.versions.unshift({ savedAt: now, label: label || (entry.versions.length ? "Saved" : "Created"), cases: meta.cases, state });
            entry.versions = entry.versions.slice(0, MAX_VERSIONS);
        }
        try {
            await this.put(entry);
            this.lastSaved = now;
            updateSavedLabel();
        } catch (e) {
            App.toast("Couldn't save to history: " + (e && e.message ? e.message : "storage unavailable"));
        }
        return entry;
    },

    autosave() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.save(), 2500);
    },

    checkpoint(label) {
        clearTimeout(this.timer);
        return this.save({ version: true, label });
    },
};

function newProjectId() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function stamp(ts) {
    return new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function updateSavedLabel() {
    const el = $("savedLabel");
    if (!el) return;
    el.textContent = History.lastSaved ? "Saved " + timeAgo(History.lastSaved) : "";
    el.title = History.lastSaved ? "Saved to History at " + stamp(History.lastSaved) : "";
}
setInterval(updateSavedLabel, 30000);

// Load a saved state as the current project
async function loadProject(entry, state, message) {
    const keep = { chat: [], ai: App.state.ai };
    App.state = normalize({ ...JSON.parse(JSON.stringify(state)), ...keep, projectId: entry.id });
    if (entry.sources) await Sources.replace(entry.sources);
    App.undoStack = [];
    updateUndoButton();
    App.collapsed.clear();
    App.afterChange();
    Chat.render();
    switchTab(App.state.suite.sections.length ? "workbook" : "setup");
    History.lastSaved = entry.updatedAt;
    updateSavedLabel();
    App.toast(message);
}

// ---------- History dialog ----------

const openVersions = new Set();

async function openHistory() {
    await History.save();                       // make sure the current suite is in the list
    $("historySearch").value = "";
    await renderHistory();
    $("historyDialog").showModal();
}

async function renderHistory() {
    const query = $("historySearch").value.trim().toLowerCase();
    const entries = (await History.all())
        .filter(e => !query || [e.name, e.fileName, e.code, (e.modules || []).join(" ")].join(" ").toLowerCase().includes(query))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    $("historyCount").textContent = entries.length ? `${entries.length} saved suite${entries.length === 1 ? "" : "s"}` : "";

    if (!entries.length) {
        $("historyList").innerHTML = `<p class="hist-empty">${query ? "No saved suite matches your search." : "Nothing saved yet. Suites are saved here automatically as you work."}</p>`;
        return;
    }
    $("historyList").innerHTML = entries.map(e => {
        const current = e.id === App.state.projectId;
        const s = e.stats || { total: e.cases || 0, Pass: 0, Fail: 0, Blocked: 0 };
        const untested = s.total - s.Pass - s.Fail - s.Blocked;
        const open = openVersions.has(e.id);
        return `
        <article class="hist-item ${current ? "current" : ""}" data-id="${e.id}">
            <div class="hist-row">
                <div class="hist-main">
                    <div class="hist-title">
                        ${e.code ? `<span class="hist-code mono">${escapeHtml(e.code)}</span>` : ""}
                        <strong>${escapeHtml(e.name)}</strong>
                        ${current ? '<span class="hist-badge">Open now</span>' : ""}
                    </div>
                    <div class="hist-meta">
                        ${e.fileName ? `<span class="mono">${escapeHtml(e.fileName)}</span> · ` : ""}${e.cases || 0} case${e.cases === 1 ? "" : "s"}${(e.modules || []).length ? " · " + escapeHtml(e.modules.join(", ")) : ""} · updated ${escapeHtml(timeAgo(e.updatedAt))}${(e.sources || []).length ? ` · ${e.sources.length} source${e.sources.length === 1 ? "" : "s"}` : ""}
                    </div>
                    ${s.total ? `<div class="bar hist-bar" title="${s.Pass} passed, ${s.Fail} failed, ${s.Blocked} blocked, ${untested} untested">
                        ${s.Pass ? `<span class="seg seg-pass" style="width:${s.Pass / s.total * 100}%"></span>` : ""}${s.Fail ? `<span class="seg seg-fail" style="width:${s.Fail / s.total * 100}%"></span>` : ""}${s.Blocked ? `<span class="seg seg-blocked" style="width:${s.Blocked / s.total * 100}%"></span>` : ""}${untested ? `<span class="seg seg-untested" style="width:${untested / s.total * 100}%"></span>` : ""}
                    </div>` : ""}
                </div>
                <div class="hist-actions">
                    ${current ? "" : `<button type="button" class="btn btn-primary btn-sm" data-h-open="${e.id}">Open</button>`}
                    <button type="button" class="btn btn-sm" data-h-versions="${e.id}" aria-expanded="${open}">Versions (${(e.versions || []).length})</button>
                    <button type="button" class="icon-btn" data-h-download="${e.id}" title="Download .xlsx" aria-label="Download ${escapeHtml(e.name)}" ${e.cases ? "" : "disabled"}>
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button type="button" class="icon-btn" data-h-duplicate="${e.id}" title="Duplicate" aria-label="Duplicate ${escapeHtml(e.name)}">
                        <svg viewBox="0 0 24 24" width="16" height="16"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                    </button>
                    <button type="button" class="icon-btn danger" data-h-delete="${e.id}" title="Delete from history" aria-label="Delete ${escapeHtml(e.name)}">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    </button>
                </div>
            </div>
            ${open ? `
            <div class="hist-versions">
                ${(e.versions || []).map((v, i) => `
                    <div class="hist-version">
                        <span class="hist-dot ${i === 0 ? "latest" : ""}"></span>
                        <span class="hist-v-label">${escapeHtml(v.label)}</span>
                        <span class="hist-v-meta">${escapeHtml(stamp(v.savedAt))} · ${v.cases} case${v.cases === 1 ? "" : "s"}</span>
                        <button type="button" class="link-btn" data-h-restore="${e.id}" data-v="${i}">${current && i === 0 ? "Reload" : "Restore"}</button>
                    </div>`).join("")}
            </div>` : ""}
        </article>`;
    }).join("");
}

async function historyAction(event) {
    const btn = event.target.closest("button");
    if (!btn) return;
    const d = btn.dataset;

    if (d.hOpen) {
        await History.save();
        const entry = await History.get(d.hOpen);
        $("historyDialog").close();
        await loadProject(entry, entry.state, `Opened "${entry.name}". Changes are saved to History automatically.`);
    }
    if (d.hVersions) {
        openVersions.has(d.hVersions) ? openVersions.delete(d.hVersions) : openVersions.add(d.hVersions);
        renderHistory();
    }
    if (d.hRestore) {
        const entry = await History.get(d.hRestore);
        const version = entry.versions[Number(d.v)];
        if (!confirm(`Restore "${entry.name}" to the version "${version.label}" from ${stamp(version.savedAt)}? The current state is kept as a version.`)) return;
        if (entry.id === App.state.projectId) await History.checkpoint("Before restore");
        else await History.save();
        const fresh = await History.get(d.hRestore);
        $("historyDialog").close();
        await loadProject(fresh, version.state, `Restored "${version.label}" (${stamp(version.savedAt)}).`);
        await History.checkpoint(`Restored: ${version.label}`);
    }
    if (d.hDownload) {
        const entry = await History.get(d.hDownload);
        const s = entry.state;
        const name = (s.project.fileName || entry.name).replace(/\.xlsx$/i, "").replace(/[^\w\- ]+/g, "").trim().replace(/[\s\-]+/g, "_") || "Test_Cases";
        download(buildWorkbook(s.project, s.suite, s.data, workbookMeta(s)), name + ".xlsx");
    }
    if (d.hDuplicate) {
        const entry = await History.get(d.hDuplicate);
        const now = Date.now();
        const copy = JSON.parse(JSON.stringify(entry));
        copy.id = newProjectId();
        copy.name = entry.name + " (copy)";
        copy.state.project.name = copy.name;
        copy.state.projectId = copy.id;
        copy.createdAt = copy.updatedAt = now;
        copy.versions = [{ savedAt: now, label: `Duplicated from "${entry.name}"`, cases: entry.cases, state: copy.state }];
        await History.put(copy);
        renderHistory();
        App.toast(`Created "${copy.name}".`);
    }
    if (d.hDelete) {
        const entry = await History.get(d.hDelete);
        if (!confirm(`Delete "${entry.name}" and its ${entry.versions.length} version${entry.versions.length === 1 ? "" : "s"} from History? This can't be undone.`)) return;
        await History.remove(d.hDelete);
        if (d.hDelete === App.state.projectId) App.state.projectId = newProjectId();   // the open suite is saved again as a new entry
        renderHistory();
        App.toast(`Deleted "${entry.name}" from History.`);
    }
}

// ---------- New / clear dialog ----------

function openNewDialog() {
    const cases = App.state.suite.sections.reduce((n, s) => n + s.cases.length, 0);
    $("newCurrent").textContent = History.hasContent()
        ? `Current: ${App.state.project.name || "Untitled suite"} · ${cases} case${cases === 1 ? "" : "s"} — saved to History first.`
        : "Nothing to save — the current suite is empty.";
    $("newKeepSources").checked = false;
    $("newDialog").showModal();
}

async function startNewSuite() {
    const removeSources = !$("newKeepSources").checked;
    const hadContent = History.hasContent();
    await History.checkpoint("Before clearing everything");
    const ai = App.state.ai;
    App.state = defaultState();
    App.state.ai = ai;
    App.state.projectId = newProjectId();
    if (removeSources) await Sources.clear();
    App.undoStack = [];
    updateUndoButton();
    App.collapsed.clear();

    $("caseSearch").value = "";
    App.afterChange();
    Chat.render();
    renderSources();
    History.lastSaved = null;
    updateSavedLabel();
    $("newDialog").close();
    switchTab("setup");
    renderSetup();
    window.scrollTo(0, 0);
    App.toast(hadContent ? "Everything cleared. The previous suite is saved in History." : "Everything cleared.");
}

async function clearTestCases() {
    const cases = App.state.suite.sections.reduce((n, s) => n + s.cases.length, 0);
    if (!cases) {
        $("newDialog").close();
        App.toast('There are no test cases to clear. Use "Clear everything" to clear the Setup.');
        return;
    }
    await History.checkpoint("Before clearing test cases");
    App.snapshot("Clear test cases");
    App.state.suite = { sections: [] };
    App.afterChange();
    $("newDialog").close();
    switchTab("setup");
    App.toast(`Cleared ${cases} test cases. Setup is kept — use "Clear everything" to clear it too.`, true);
}

function initHistoryUi() {
    $("newBtn").addEventListener("click", openNewDialog);
    if ($("clearAllBtn")) $("clearAllBtn").addEventListener("click", openNewDialog);
    $("historyBtn").addEventListener("click", openHistory);
    $("newStart").addEventListener("click", startNewSuite);
    $("newClear").addEventListener("click", clearTestCases);
    $("newCancel").addEventListener("click", () => $("newDialog").close());
    $("historyClose").addEventListener("click", () => $("historyDialog").close());
    $("historySearch").addEventListener("input", renderHistory);
    $("historyList").addEventListener("click", historyAction);
    $("historySaveVersion").addEventListener("click", async () => {
        if (!History.hasContent()) { App.toast("Nothing to save yet."); return; }
        const label = prompt("Name this version (optional):", "Saved manually");
        if (label === null) return;
        await History.checkpoint(label.trim() || "Saved manually");
        renderHistory();
        App.toast("Version saved.");
    });
    // Save before the tab closes
    window.addEventListener("pagehide", () => { History.save(); });
}
