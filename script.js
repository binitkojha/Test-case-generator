// Test Case Generator — app state, views (Setup, Test Cases, Dashboard, Test Data), editing, undo, import / export.
// Generation: generator.js · Excel: xlsx.js · Import: importer.js · Assistant: chat.js

const STORAGE_KEY = "tcg-standard-v1";
const PANEL_KEY = "tcg-assistant-open";
const MAX_UNDO = 40;

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_MODULE = { code: "", name: "", description: "", precondition: "", scenarios: "" };

const SURFACES = ["Time Clock device", "Manager web", "Settings", "Reports", "Mobile app"];
const AREA_TYPES = ["NEW", "EXISTING-REVAMPED"];

function defaultState() {
    return {
        project: {
            name: "", code: "", infix: "CR", fileName: "", environment: "QA", testedBy: "QA Team",
            executionDate: today(), platform: "iOS and Android", basePre: "", basis: "", defaultStatus: "Pass", evidence: "",
        },
        scope: "changed",
        changeAreas: [{ area: "", type: "NEW" }],
        surfaces: [],
        basisText: "",
        modules: [{ ...EMPTY_MODULE }],
        form: { module: "", submit: "Continue", fields: "" },
        actions: "",
        reports: "",
        regression: "",
        data: ENVIRONMENT_DATA.map(d => ({ ...d })),
        coverage: { validation: true, buttons: true, reports: true, regression: true, edge: true },
        suite: { sections: [] },
        projectId: newProjectId(),
        chat: [],
        ai: { enabled: false },
        tab: "setup",
    };
}

function normalize(saved) {
    const base = defaultState();
    if (!saved || typeof saved !== "object") return base;
    // Projects saved before Standard v3: INT → RPT
    if (saved.integration && !saved.reports) saved.reports = saved.integration;
    delete saved.integration;
    delete saved.integrationTitle;
    if (saved.coverage) { delete saved.coverage.api; delete saved.coverage.db; delete saved.coverage.integration; }
    // Team format: environment and platform are separate fields
    if (saved.project) {
        const env = /^(.*?)\s*\((iOS[^)]*|Android[^)]*)\)\s*$/i.exec(saved.project.environment || "");
        if (env) { saved.project.environment = env[1].trim(); saved.project.platform = env[2].trim(); }
        if (!saved.project.platform || /time clock device/i.test(saved.project.platform)) saved.project.platform = "iOS and Android";
    }
    return {
        ...base,
        ...saved,
        project: { ...base.project, ...(saved.project || {}) },
        form: { ...base.form, ...(saved.form || {}) },
        coverage: { ...base.coverage, ...(saved.coverage || {}) },
        ai: { ...base.ai, ...(saved.ai || {}) },
        modules: Array.isArray(saved.modules) && saved.modules.length ? saved.modules.map(m => ({ ...EMPTY_MODULE, ...m })) : base.modules,
        data: Array.isArray(saved.data) ? saved.data : base.data,
        changeAreas: Array.isArray(saved.changeAreas) && saved.changeAreas.length ? saved.changeAreas : base.changeAreas,
        surfaces: Array.isArray(saved.surfaces) ? saved.surfaces : base.surfaces,
        suite: saved.suite && Array.isArray(saved.suite.sections) ? saved.suite : base.suite,
        chat: Array.isArray(saved.chat) ? saved.chat : [],
    };
}

function escapeHtml(text) {
    return String(text == null ? "" : text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    if (target) target[last] = value;
}

const $ = id => document.getElementById(id);

// ================= App =================

const App = {
    state: defaultState(),
    undoStack: [],
    collapsed: new Set(),

    save() {
        clearTimeout(App.saveTimer);
        App.saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch (e) { /* storage full or blocked */ }
            History.autosave();
        }, 250);
    },

    snapshot(label) {
        App.undoStack.push({ label, suite: JSON.stringify(App.state.suite), data: JSON.stringify(App.state.data) });
        if (App.undoStack.length > MAX_UNDO) App.undoStack.shift();
        updateUndoButton();
    },

    undo() {
        const snap = App.undoStack.pop();
        updateUndoButton();
        if (!snap) return false;
        App.state.suite = JSON.parse(snap.suite);
        App.state.data = JSON.parse(snap.data);
        App.afterChange();
        return true;
    },

    selected: new Set(),            // case uids chosen as Smart's scope

    afterChange() {
        ensureUids(App.state.suite);
        for (const uid of [...App.selected]) if (!allCases(App.state.suite).some(x => x.c.uid === uid)) App.selected.delete(uid);
        App.save();
        renderCounts();
        renderTab(App.state.tab);
    },

    setSearch(query) {
        switchTab("cases");
        $("caseSearch").value = query;
        renderCases();
    },

    toast(message, withUndo = false) {
        const toast = $("toast");
        toast.innerHTML = `<span>${escapeHtml(message)}</span>${withUndo ? '<button type="button" id="toastUndo">Undo</button>' : ""}`;
        toast.hidden = false;
        if (withUndo) $("toastUndo").onclick = () => { App.undo(); toast.hidden = true; };
        clearTimeout(App.toastTimer);
        App.toastTimer = setTimeout(() => { toast.hidden = true; }, withUndo ? 6000 : 3000);
    },
};

function updateUndoButton() {
    const btn = $("undoBtn");
    const last = App.undoStack[App.undoStack.length - 1];
    btn.disabled = !last;
    btn.title = last ? "Undo: " + last.label : "Nothing to undo";
}

// ================= Tabs =================

function switchTab(name) {
    const changed = App.state.tab !== name;
    App.state.tab = name;
    document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = p.id !== "tab-" + name; });
    document.querySelectorAll("[data-tab]").forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle("active", on);
        if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    setNavOpen(false);
    if (changed) window.scrollTo(0, 0);
    renderTab(name);
    App.save();
}

// ================= Shell: mobile drawer, collapsible sidebar, theme =================

function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
    const scrim = $("scrim");
    if (scrim) scrim.hidden = !open;
    if ($("navToggle")) $("navToggle").setAttribute("aria-expanded", open);
}

function setNavCollapsed(collapsed) {
    document.documentElement.classList.toggle("nav-collapsed", collapsed);
    const btn = $("navCollapse");
    btn.setAttribute("aria-expanded", !collapsed);
    btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    btn.setAttribute("aria-label", btn.title);
    try { localStorage.setItem("tcg-sidebar", collapsed ? "collapsed" : "expanded"); } catch (e) { /* ignore */ }
}

function setTheme(choice) {
    if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("tcg-theme", choice); } catch (e) { /* ignore */ }
    document.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", b.dataset.themeChoice === choice));
}

$("navToggle").addEventListener("click", () => setNavOpen(!document.body.classList.contains("nav-open")));
$("scrim").addEventListener("click", () => setNavOpen(false));
$("navCollapse").addEventListener("click", () => setNavCollapsed(!document.documentElement.classList.contains("nav-collapsed")));
document.querySelectorAll("[data-theme-choice]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themeChoice)));
document.addEventListener("keydown", event => { if (event.key === "Escape" && document.body.classList.contains("nav-open")) setNavOpen(false); });
(() => {
    let theme = "system";
    try { theme = localStorage.getItem("tcg-theme") || "system"; } catch (e) { /* ignore */ }
    setTheme(theme);
    setNavCollapsed(document.documentElement.classList.contains("nav-collapsed"));
})();

function renderTab(name) {
    if (name === "setup") renderSetup();
    if (name === "cases") renderCases();
    if (name === "dashboard") renderDashboard();
    if (name === "data") renderData();
    if (name === "workbook") renderWorkbook();
    if (name === "rules") renderRules();
}

document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

function renderCounts() {
    const cases = App.state.suite.sections.reduce((n, s) => n + s.cases.length, 0);
    $("caseCount").textContent = cases;
    // Nothing to export or check until there are test cases
    document.querySelectorAll("#exportBtn, #xlExport, [data-export]").forEach(b => {
        b.disabled = !cases;
        b.title = cases ? "Download the workbook (.xlsx)" : "Generate or import test cases first";
    });
    $("dataCount").textContent = App.state.data.length;
    updateIssueCount();
    $("projectLabel").textContent = App.state.project.name || "Untitled project";
    document.title = (App.state.project.name ? App.state.project.name + " · " : "") + "Test Case Generator";
}

// ================= Bindings =================

function fillBindings(root) {
    root.querySelectorAll("[data-bind]").forEach(el => {
        if (el.isContentEditable) return;
        const value = getPath(App.state, el.dataset.bind);
        if (el.type === "checkbox") el.checked = !!value;
        else if (document.activeElement !== el) el.value = value == null ? "" : value;
    });
}

document.addEventListener("input", event => {
    const el = event.target.closest("[data-bind]");
    if (!el || el.closest("#assistant")) return;
    const path = el.dataset.bind;
    let value;
    if (el.isContentEditable) value = el.innerText.replace(/\n$/, "");
    else if (el.type === "checkbox") value = el.checked;
    else value = el.value;

    if (el.classList.contains("upper") && !el.isContentEditable) {
        const upper = value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
        if (upper !== value) {
            const pos = el.selectionStart;
            el.value = upper;
            el.setSelectionRange(pos, pos);
        }
        value = upper;
    }
    setPath(App.state, path, value);
    onBoundChange(path, el);
    App.save();
});

function onBoundChange(path, el) {
    // Keep the same field in sync on other tabs (e.g. project name on Setup and Dashboard)
    document.querySelectorAll(`[data-bind="${CSS.escape(path)}"]`).forEach(other => {
        if (other !== el && !other.isContentEditable) {
            if (other.type === "checkbox") other.checked = el.checked;
            else other.value = getPath(App.state, path);
        }
    });

    if (path.startsWith("project.")) {
        // Typed by the tester: kept when Generate reads the files again
        const field = path.split(".")[1];
        App.state.project.autoFields = (App.state.project.autoFields || []).filter(x => x !== field);
        renderCounts();
        if (App.state.tab === "setup") renderDetected();
        if (App.state.tab === "dashboard") renderDashboardStats();
    }
    if (path === "basisText") { renderBasisStats(); renderGenerateHint(); }

    const caseMatch = /^suite\.sections\.(\d+)\.cases\.(\d+)\.(importance|steps\.(\d+)\.status)$/.exec(path);
    if (caseMatch) {
        // A passed step gets the past-tense mirror of its Expected Result as the Actual Result
        if (caseMatch[4] !== undefined) {
            const theCase = App.state.suite.sections[caseMatch[1]].cases[caseMatch[2]];
            const step = theCase.steps[caseMatch[4]];
            if (step.status === "Pass" && !step.actual.trim()) step.actual = pastTense(step.expected);
            if (step.status === "Pass" && !(theCase.evidence || "").trim() && !(App.state.project.evidence || "").trim()) {
                App.toast(`Pass needs execution evidence — add it to ${theCase.id} or under Workbook details.`);
            }
        }
        refreshCase(Number(caseMatch[1]), Number(caseMatch[2]));
        updateIssueCount();
    }
    if (/^suite\.sections\.\d+\.(title|name)$/.test(path)) renderSectionFilter();
    if (/^suite\.sections\.\d+\.cases\.\d+\.evidence$/.test(path) || path === "project.evidence") updateIssueCount();
}

// Plain-text paste and single-line fields in contenteditable cells
document.addEventListener("paste", event => {
    const el = event.target.closest("[contenteditable]");
    if (!el) return;
    event.preventDefault();
    let text = (event.clipboardData || window.clipboardData).getData("text/plain");
    if (el.dataset.single !== undefined) text = text.replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
});

document.addEventListener("keydown", event => {
    const el = event.target.closest("[contenteditable]");
    if (el && el.dataset.single !== undefined && event.key === "Enter") {
        event.preventDefault();
        el.blur();
    }
    const editing = event.target.closest("input, textarea, select, [contenteditable]");
    if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (App.undo()) App.toast("Undone.");
    }
});

// ================= Setup =================
// Two steps: add what changed, then generate. Everything else the standard needs — modules, scope, change areas,
// surfaces, RPT / REG / EDG, precondition and Test Data — is worked out from the files on each Generate.

const FUNCTIONAL_CODES = Object.keys(MODULE_NAMES).filter(c => !TAIL_SECTIONS[c]);

function renderSetup() {
    ensureEnvironment();
    fillBindings($("tab-setup"));
    renderBasisStats();
    renderSources();
    renderEngine();
    renderDetected();
    renderGenerateHint();
}

// Kit test basis files (used by the File menu samples)
function applyBasis(basis) {
    const s = App.state;
    Object.assign(s.project, { basis: basis.key, code: basis.code, infix: "CR", name: basis.name, fileName: basis.fileName });
    s.basisText = basis.text;
    App.save();
    renderSetup();
    renderCounts();
}

// ---------- Environment (Test Data rows 1–5) ----------

// Team format: the six Environment rows first, in order. Rows from earlier versions are carried over or dropped.
function ensureEnvironment() {
    let data = App.state.data;
    const site = data.find(d => d.category === "Environment" && d.item === "Site");
    data = data.filter(d => !(d.category === "Environment" && LEGACY_ENVIRONMENT.includes(d.item)));
    const rows = ENVIRONMENT_DATA.map(std => {
        const i = data.findIndex(d => d.item.toLowerCase() === std.item.toLowerCase());
        if (i >= 0) return data.splice(i, 1)[0];
        const row = { ...std };
        if (std.item === "Tenant or site" && site && site.value) row.value = site.value;
        if (std.item === "Platform" && App.state.project.platform) row.value = App.state.project.platform;
        return row;
    });
    App.state.data = [...rows, ...data];
}

function isPlaceholder(value) {
    return /<[^>]+>|placeholder|tbc|confirm/i.test(value || "");
}

// ---------- Test basis ----------

function renderBasisStats() {
    const files = Sources.list.length;
    const text = (App.state.basisText || "").trim();
    $("basisStats").textContent = [files ? `${files} file${files === 1 ? "" : "s"}` : "", text ? `${text.length.toLocaleString()} chars of details` : ""].filter(Boolean).join(" · ");
    $("basisStats").hidden = !files && !text;
}

function functionalModules() {
    return App.state.modules.filter(m => m.code.trim() && !TAIL_SECTIONS[m.code.toUpperCase()]);
}

// ---------- What was worked out from the files (read-only) ----------

function renderDetected() {
    const s = App.state;
    const codes = functionalModules().map(m => m.code.toUpperCase());
    const cases = s.suite.sections.reduce((n, x) => n + x.cases.length, 0);
    $("s-review").hidden = !codes.length && !cases;
    $("youGet").innerHTML = codes.length || cases ? "" : `
        <div class="you-get">
            <span class="you-get-title">You'll get</span>
            <ul>
                <li><b>Sheets</b> Dashboard, Sheet1, Test Data</li>
                <li><b>Modules</b> + UI, API, DB, INT, RPT, REG, EDG</li>
                <li><b>IDs</b> <code>PREFIX_CR_MOD_001</code></li>
                <li><b>Checked</b> against the team format</li>
            </ul>
        </div>`;
    if ($("s-review").hidden) { $("detected").innerHTML = ""; return; }
    const areas = s.changeAreas.filter(a => a.area.trim());
    const modules = cases
        ? s.suite.sections.map(x => `<span class="mod-chip ${TAIL_SECTIONS[x.code] ? "tail" : ""}" title="${escapeHtml(x.title || x.name || "")}"><b>${escapeHtml(x.code)}</b>${x.cases.length}</span>`)
        : [...codes, ...tailPlan(s.scope)].map(c => `<span class="mod-chip ${TAIL_SECTIONS[c] ? "tail" : ""}"><b>${c}</b></span>`);
    const errors = cases ? checkSuite(s).errors.length : 0;
    $("detected").innerHTML = `
        <div class="stat-row">
            <div class="stat"><span>Test cases</span><strong>${cases}</strong></div>
            <div class="stat"><span>Modules</span><strong>${cases ? s.suite.sections.length : codes.length + tailPlan(s.scope).length}</strong></div>
            <div class="stat"><span>Test Data</span><strong>${s.data.length}</strong></div>
            <div class="stat ${errors ? "bad" : "good"}"><span>Standard check</span><strong>${cases ? (errors ? `${errors} to fix` : "Pass") : "—"}</strong></div>
        </div>
        <div class="found">
            <div><span class="found-label">Project</span><p><strong>${escapeHtml(s.project.name || "—")}</strong> <code>${escapeHtml(s.project.code ? idPrefix(s.project, "MOD") + "_001" : "")}</code></p></div>
            <div><span class="found-label">Scope</span><p>${escapeHtml((SCOPES[s.scope] || SCOPES.changed).label)}${s.intake && s.intake.designLink ? ` · design: <a href="${escapeHtml(s.intake.designLink)}" target="_blank" rel="noopener">link</a>` : ""}</p></div>
            <div><span class="found-label">Modules</span><p class="mod-chips">${modules.join("")}</p></div>
            ${areas.length ? `<div><span class="found-label">Change areas</span><p class="tags">${areas.map(a => `<span class="tag">${escapeHtml(a.area)}<small>${a.type === "NEW" ? "new" : "revamped"}</small></span>`).join("")}</p></div>` : ""}
            ${s.surfaces.length ? `<div><span class="found-label">Surfaces</span><p class="tags">${s.surfaces.map(x => `<span class="tag">${escapeHtml(x)}</span>`).join("")}</p></div>` : ""}
        </div>`;
}

document.addEventListener("click", event => {
    const go = event.target.closest("[data-goto-tab]");
    if (go) switchTab(go.dataset.gotoTab);
    if (event.target.closest("[data-export]")) $("exportBtn").click();
});
// ---------- Required parameters ----------
// Only the sources are needed from the tester. The rest is filled from the files (or sensible defaults) on Generate.

function setupProblems() {
    const s = App.state;
    const p = s.project;
    const missing = [];
    if (!p.code.trim()) missing.push("prefix");
    if (!/\.xlsx$/i.test((p.fileName || "").trim())) missing.push("file name (.xlsx)");
    if (!p.name.trim()) missing.push("project name");
    if (!p.environment.trim()) missing.push("test environment");
    if (!p.testedBy.trim()) missing.push("tested by");
    if (!p.executionDate) missing.push("execution date");
    if (!s.changeAreas.some(a => a.area.trim())) missing.push("a change area");
    if (!s.surfaces.length) missing.push("surfaces");
    if (!functionalModules().length) missing.push("a functional module");
    return missing;
}

function renderGenerateHint() {
    const hint = $("generateHint");
    const files = Sources.list.length;
    const text = (App.state.basisText || "").trim();
    const engineText = engine() === "smart" ? "Smart reads the text, screenshots and recordings" : "Offline reads the text of your files";
    const cases = App.state.suite.sections.reduce((n, x) => n + x.cases.length, 0);
    const flow = { add: files || text ? "done" : "current", generate: cases ? "done" : files || text ? "current" : "", review: cases ? "current" : "" };
    document.querySelectorAll("#flowSteps [data-flow]").forEach(li => { li.className = flow[li.dataset.flow] || ""; });
    if (!files && !text) {
        hint.textContent = "Add files or details in step 1 to start.";
        hint.className = "gen-hint idle";
    } else if (engine() === "smart" && !SmartSettings.ready()) {
        hint.textContent = "Smart isn't connected — check Smart settings in the Assistant, or choose Offline.";
        hint.className = "gen-hint warn";
    } else {
        hint.textContent = cases ? `${cases} cases generated. Generate again after changing the files or details.` : `Ready — ${engineText} and writes every case in the standard format.`;
        hint.className = "gen-hint ok";
    }
    ["generateBtn", "generateBtn2"].forEach(id => { if ($(id)) $(id).disabled = !files && !text; });
}

$("generateBtn").addEventListener("click", generate);
document.addEventListener("click", event => {
    const link = event.target.closest("a[data-goto]");
    if (!link) return;
    event.preventDefault();
    switchTab(link.dataset.goto);
});

// ---------- Engine: Smart (default) or Offline ----------

function engine() {
    // Offline first: Smart only when the tester picks it
    return App.state.ai.engine === "smart" ? "smart" : "offline";
}

function renderEngine() {
    document.querySelectorAll("#engineGroup input").forEach(r => { r.checked = r.value === engine(); });
    $("engineNote").textContent = engine() === "smart"
        ? "Smart reads text, screenshots and recordings, and follows your format & rules."
        : "Offline reads the text of your files and your notes on recordings, in this browser. Text inside screenshots is not read.";
    $("engineNote").className = "hint engine-note";
    renderGenerateHint();
}

$("engineGroup").addEventListener("change", event => {
    App.state.ai.engine = event.target.value;
    App.save();
    renderEngine();
    renderGenerateHint();
});

// Smart needs the server-side service: check it, and say so when it is not reachable
async function smartReady() {
    if (SmartSettings.ready() || await SmartSettings.test({ quiet: true })) return true;
    setAssistant(true, false);
    SmartSettings.open();
    App.toast("Smart isn't connected — check Smart settings, or switch to Offline. Nothing was changed.");
    return false;
}

function requireSetup() {
    const problems = setupProblems();
    if (!problems.length) return true;
    if (problems.includes("a functional module")) {
        App.toast("Couldn't tell which screens or flows changed. Add the screen names and steps to the details in step 1" + (engine() === "offline" ? ", or use Smart." : "."));
        return false;
    }
    App.toast("Could not work out: " + problems.join(", ") + ". Add more detail about what changed, or set it under Workbook details.");
    $("workbookDetails").open = true;
    return false;
}

function hasSources() {
    return Sources.list.length > 0 || !!(App.state.basisText || "").trim();
}

// Each Generate reads the files again: what was worked out last time is cleared (project details the tester typed stay)
function resetDerived() {
    const s = App.state;
    s.scope = s.scope || "changed";             // the scope the tester confirmed is kept
    s.changeAreas = [{ area: "", type: "NEW" }];
    s.surfaces = [];
    s.modules = [{ ...EMPTY_MODULE }];
    s.reports = "";
    s.regression = "";
    s.form = { module: "", submit: "Continue", fields: "" };
    s.actions = "";
    s.project.basePre = "";
    s.smartNotes = "";
    for (let field of s.project.autoFields || []) s.project[field] = "";
    s.project.autoFields = [];
    s.scenariosFromSources = true;
}

// Project fields filled from the files (not typed) are worked out again on the next Generate
let autoBefore = null;
function rememberEmptyFields() {
    const p = App.state.project;
    autoBefore = ["name", "code", "fileName"].filter(k => !(p[k] || "").trim());
}
function markAutoFields() {
    const p = App.state.project;
    p.autoFields = [...new Set([...(p.autoFields || []), ...(autoBefore || []).filter(k => (p[k] || "").trim())])];
}

// Fill what the files did not settle with values derived from what they did
function completeDerived() {
    const s = App.state;
    const p = s.project;
    const words = (p.name || "").replace(/^.*?[—–-]\s*/, "").replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w && !/^(and|or|the|of|for|to|a|an|on|in|with)$/i.test(w));
    if (!p.name.trim()) {
        const first = Sources.list[0];
        p.name = first ? first.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") : "New enhancement";
    }
    // The prefix is never derived from a file name — the intake asks for it when the sources do not give it
    if (!/\.xlsx$/i.test((p.fileName || "").trim())) p.fileName = (words.join("_") || "Test_Cases") + ".xlsx";
    if (!p.environment.trim()) p.environment = "QA";
    if (!p.testedBy.trim()) p.testedBy = "QA Team";
    if (!p.executionDate) p.executionDate = today();
    if (!s.changeAreas.some(a => a.area.trim())) {
        const revamp = /revamp|redesign|replac|moved|updated|now shows|changed/i.test(collectDocuments().map(d => d.text).join(" "));
        s.changeAreas = functionalModules().map(m => ({ area: m.description || m.name || MODULE_NAMES[m.code] || m.code, type: revamp ? "EXISTING-REVAMPED" : "NEW" }));
    }
    if (!s.surfaces.length) {
        const all = collectDocuments().map(d => d.text).join(" ");
        s.surfaces = SURFACES.filter(x => (x === "Manager web" && /manager|dashboard|web/i.test(all)) || (x === "Settings" && /setting|toggle|configur/i.test(all))
            || (x === "Reports" && /report/i.test(all)) || (x === "Mobile app" && /mobile app/i.test(all)));
        if (!s.surfaces.length || /time clock|clock in|clock out|kiosk|device/i.test(all)) s.surfaces.unshift("Time Clock device");
        s.surfaces = [...new Set(s.surfaces)];
    }
    markAutoFields();
}

// Generate: read the files, work out the setup, then write every module in the standard format
async function generate() {
    if (!hasSources()) {
        App.toast("Add files or details about what changed first.");
        $("s-basis").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }
    const existing = App.state.suite.sections.reduce((n, x) => n + x.cases.length, 0);
    if (existing && !confirm(`Replace the current ${existing} test cases with new ones from your files? The current suite stays in History, and you can undo.`)) return;
    if (existing) History.checkpoint("Before generating again");

    if (engine() === "smart") {
        if (!(await smartReady())) return;
        resetDerived();
        rememberEmptyFields();
        const ok = await analyseSourcesWithAi();
        if (!ok) return;
        completeDerived();
        App.save();
        renderSetup();
        if (!(await runIntake())) return;
        renderSetup();
        if (!requireSetup()) return;
        return aiWrite();
    }
    return generateOffline();
}

async function generateOffline() {
    const s = App.state;
    if (!collectDocuments().length) {
        const images = Sources.flat().reduce((n, x) => n + Sources.imageCount(x), 0);
        App.toast(images
            ? "Offline can't read text inside screenshots or recordings. Add notes to the recording (View), paste the details in step 1, or use Smart."
            : "No readable text found. Upload release notes, a spec, slides or a PDF with text, or paste the details.");
        return;
    }
    resetDerived();
    rememberEmptyFields();
    // A failed read still marks what it filled in, so the next Generate works it out again
    if (!generateFromSources()) { markAutoFields(); return; }
    completeDerived();
    renderSetup();
    // Nothing to write about: say so before asking the tester to confirm anything
    if (!functionalModules().length) { requireSetup(); return; }
    if (!(await runIntake())) return;
    renderSetup();
    if (!requireSetup()) { renderSetup(); return; }
    const written = s.modules.reduce((n, m) => n + parseScenarios(m.scenarios).length, 0) + parseScenarios(s.reports).length + parseScenarios(s.regression).length;
    if (!written) {
        App.toast("No flows or behaviours found in the text. Add the steps and what should happen, or use Smart.");
        renderSetup();
        return;
    }
    App.snapshot("Generate");
    // Team rules from Format & rules: extra cases go in before building, wording / importance / preconditions after
    const team = parseTeamRules(Rules.teamRules);
    { const inFormat = formatLines(); team.other = team.other.filter(l => !inFormat.has(l)); }
    const input = withTeamScenarios({ ...s, modules: functionalModules().filter(m => m.name.trim()) }, team);
    input.state.teamCoverage = detectCoverage(collectDocuments().map(d => d.text).join("\n"));
    const result = generateSuite(input.state);
    const applied = applyTeamRules(result.suite, team);
    numberCases(result.suite, s.project);
    s.suite = result.suite;
    s.data = result.data;
    applyNameMap();                                  // names the tester changed in Commands stay changed
    App.collapsed.clear();
    App.afterChange();
    switchTab("workbook");
    const total = result.suite.sections.reduce((n, x) => n + x.cases.length, 0);
    History.checkpoint("Generated offline");
    const ruleCount = applied.filter(a => a.count).length + team.scenarios.length - input.skipped.length;
    App.toast(`${total} test cases generated in ${result.suite.sections.length} modules${ruleCount ? ` · ${ruleCount} team rule${ruleCount === 1 ? "" : "s"} applied` : ""}${team.other.length ? ` · ${team.other.length} rule${team.other.length === 1 ? " needs" : "s need"} Smart` : ""}.`, true);
}

// Smart generation: one request per module; every proposed case is validated and reviewed before it is written
async function aiWrite() {
    if (!requireSetup()) return;
    if (!(await smartReady())) return;
    const s = App.state;
    const plan = [...functionalModules().map(m => ({ code: m.code.toUpperCase(), name: m.name, title: m.description || m.name })),
        ...tailPlan(s.scope).map(code => ({ code, name: TAIL_SECTIONS[code].name, title: TAIL_SECTIONS[code].title }))];
    const design = s.intake && s.intake.designLink ? `design material: ${s.intake.designLink}` : s.intake && s.intake.designNone ? "no design material — mark visual details \"To confirm:\"" : "design material: the uploaded screens";
    const header = `Prefix ${s.project.code} · IDs ${idPrefix(s.project, "MOD")}_NNN · ${s.project.name} · scope: ${(SCOPES[s.scope] || SCOPES.changed).label} · surfaces: ${s.surfaces.join(", ")} · change areas: ${s.changeAreas.map(a => `${a.area} (${a.type})`).join("; ")} · ${design}.`;
    SmartReview.replaceOnApply = true;          // approved cases replace the current suite (undoable)
    await SmartCommands.generateModules(plan, header);
}

// ---------- Intake (team format): confirm four things before generating — never guess ----------
// Change areas (NEW / EXISTING-REVAMPED), surfaces, design material and scope, plus the official prefix.
// Pre-filled from the files; anything missing must be filled in before Confirm.

let intakeResolve = null;

function designSummary() {
    const flat = Sources.flat();
    const images = flat.reduce((n, x) => n + Sources.imageCount(x), 0);
    const videos = flat.filter(x => x.kind === "video").length;
    return { images, videos, text: [images ? `${images} screen${images === 1 ? "" : "s"}` : "", videos ? `${videos} recording${videos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ") };
}

function intakeDraft() {
    const s = App.state;
    const prev = s.intake || {};
    const all = collectDocuments().map(d => d.text).join(" ");
    const uiOnly = /\bUI[- ]only\b|\bvisual (?:refresh|update)s? only\b|\bno (?:backend|api) changes?\b/i.test(all);
    return {
        areas: s.changeAreas.filter(a => a.area.trim()).map(a => ({ ...a })),
        surfaces: [...s.surfaces],
        designLink: prev.designLink || "",
        designNone: !!prev.designNone,
        scope: prev.confirmed ? s.scope : (uiOnly ? "ui" : s.scope || "changed"),
        prefix: s.project.code || "",
    };
}

function intakeProblems(d) {
    const missing = [];
    if (!d.areas.some(a => a.area.trim())) missing.push("change areas");
    if (d.areas.some(a => a.area.trim() && !["NEW", "EXISTING-REVAMPED"].includes(a.type))) missing.push("NEW or EXISTING-REVAMPED for each area");
    if (!d.surfaces.length) missing.push("surfaces");
    if (!designSummary().images && !designSummary().videos && !d.designLink.trim() && !d.designNone) missing.push("design material");
    if (!SCOPES[d.scope]) missing.push("scope");
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(d.prefix)) missing.push("prefix");
    return missing;
}

let intake = null;
function renderIntake() {
    const d = intake;
    const design = designSummary();
    $("intakeAreas").innerHTML = d.areas.map((a, i) => `
        <div class="intake-area">
            <input data-intake-area="${i}" value="${escapeHtml(a.area)}" placeholder="Screen or flow that changed" aria-label="Change area ${i + 1}">
            <div class="seg" role="radiogroup" aria-label="Change area ${i + 1} type">
                ${["NEW", "EXISTING-REVAMPED"].map(t => `<button type="button" role="radio" aria-checked="${a.type === t}" data-intake-type="${i}" data-type="${t}">${t === "NEW" ? "New" : "Revamped"}</button>`).join("")}
            </div>
            <button type="button" class="icon-btn danger" data-intake-remove="${i}" aria-label="Remove change area ${i + 1}">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
        </div>`).join("") || `<p class="hint">No change area found in the files — add each screen or flow that changed.</p>`;
    $("intakeSurfaces").innerHTML = SURFACES.map(x => `
        <label class="chip-toggle"><input type="checkbox" value="${escapeHtml(x)}" ${d.surfaces.includes(x) ? "checked" : ""}> ${escapeHtml(x)}</label>`).join("");
    $("intakeDesignFound").textContent = design.text ? `Uploaded: ${design.text}.` : "No screens or recordings uploaded.";
    $("intakeDesignLink").value = d.designLink;
    $("intakeDesignNone").checked = d.designNone;
    $("intakeDesignNoneRow").hidden = !!(design.images || design.videos);
    document.querySelectorAll("#intakeScope input").forEach(r => { r.checked = r.value === d.scope; });
    $("intakePrefix").value = d.prefix;
    updateIntakeState();
}

// Flags, preview and the Confirm button — safe to call while typing (fields are not re-rendered)
function updateIntakeState() {
    const d = intake;
    $("intakeIdPreview").textContent = d.prefix ? `${d.prefix}${(SCOPES[d.scope] || SCOPES.changed).infix ? "_CR" : ""}_MOD_001` : "PREFIX_MOD_001";
    const missing = intakeProblems(d);
    const flag = (id, bad) => $(id).classList.toggle("missing", bad);
    flag("inAreas", missing.includes("change areas") || missing.some(m => /NEW or/.test(m)));
    flag("inSurfaces", missing.includes("surfaces"));
    flag("inDesign", missing.includes("design material"));
    flag("inScope", missing.includes("scope"));
    flag("inPrefix", missing.includes("prefix"));
    $("intakeMissing").textContent = missing.length ? `Still needed: ${missing.join(", ")}.` : "All set.";
    $("intakeMissing").className = "intake-missing " + (missing.length ? "warn" : "ok");
    $("intakeConfirm").disabled = missing.length > 0;
}

function runIntake() {
    intake = intakeDraft();
    renderIntake();
    $("intakeDialog").showModal();
    return new Promise(resolve => { intakeResolve = resolve; });
}

function closeIntake(confirmed) {
    if ($("intakeDialog").open) $("intakeDialog").close();
    if (confirmed) {
        const s = App.state;
        s.changeAreas = intake.areas.filter(a => a.area.trim());
        s.surfaces = intake.surfaces;
        s.scope = intake.scope;
        s.intake = { designLink: intake.designLink.trim(), designNone: intake.designNone, confirmed: true };
        s.project.code = intake.prefix;
        s.project.infix = SCOPES[intake.scope].infix;
        s.project.autoFields = (s.project.autoFields || []).filter(f => f !== "code");
        App.save();
    }
    const resolve = intakeResolve;
    intakeResolve = null;
    if (resolve) resolve(!!confirmed);
}

function initIntake() {
    const dlg = $("intakeDialog");
    dlg.addEventListener("input", e => {
        const area = e.target.closest("[data-intake-area]");
        if (area) { intake.areas[+area.dataset.intakeArea].area = area.value; updateIntakeState(); return; }
        if (e.target.id === "intakePrefix") {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
            if (v !== e.target.value) e.target.value = v;
            intake.prefix = v;
            updateIntakeState();
            return;
        }
        if (e.target.id === "intakeDesignLink") { intake.designLink = e.target.value; updateIntakeState(); }
    });
    dlg.addEventListener("change", e => {
        if (e.target.closest("#intakeSurfaces")) intake.surfaces = [...document.querySelectorAll("#intakeSurfaces input:checked")].map(i => i.value);
        if (e.target.closest("#intakeScope")) intake.scope = e.target.value;
        if (e.target.id === "intakeDesignNone") intake.designNone = e.target.checked;
        renderIntake();
    });
    dlg.addEventListener("click", e => {
        const type = e.target.closest("[data-intake-type]");
        if (type) { intake.areas[+type.dataset.intakeType].type = type.dataset.type; renderIntake(); return; }
        const remove = e.target.closest("[data-intake-remove]");
        if (remove) { intake.areas.splice(+remove.dataset.intakeRemove, 1); renderIntake(); return; }
    });
    $("intakeAddArea").addEventListener("click", () => {
        intake.areas.push({ area: "", type: "NEW" });
        renderIntake();
        const inputs = document.querySelectorAll("[data-intake-area]");
        inputs[inputs.length - 1].focus();
    });
    $("intakeConfirm").addEventListener("click", () => closeIntake(true));
    $("intakeCancel").addEventListener("click", () => closeIntake(false));
    $("intakeClose").addEventListener("click", () => closeIntake(false));
    dlg.addEventListener("cancel", e => { e.preventDefault(); closeIntake(false); });
}

// ================= Test Cases =================

const caseSearch = $("caseSearch");
const fSection = $("fSection");
const fImportance = $("fImportance");
const fStatus = $("fStatus");
[caseSearch, fSection, fImportance, fStatus].forEach(el => el.addEventListener("input", renderCases));

function renderSectionFilter() {
    const value = fSection.value;
    fSection.innerHTML = `<option value="">All modules</option>` +
        App.state.suite.sections.map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.code)} — ${escapeHtml(s.name)}</option>`).join("");
    fSection.value = App.state.suite.sections.some(s => s.code === value) ? value : "";
}

function caseMatches(c) {
    if (fImportance.value && c.importance !== fImportance.value) return false;
    if (fStatus.value && caseStatus(c) !== fStatus.value) return false;
    const q = caseSearch.value.trim().toLowerCase();
    if (q) {
        const hay = [c.id, c.description, c.pre, c.data, ...c.steps.flatMap(s => [s.action, s.expected, s.actual])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

function filtersActive() {
    return !!(caseSearch.value.trim() || fImportance.value || fStatus.value || fSection.value);
}

const STATUS_CLASS = { Pass: "pass", Fail: "fail", Blocked: "blocked", Untested: "untested" };

function editable(path, value, { single = false, ph = "", cls = "" } = {}) {
    return `<div class="ce ${cls}" contenteditable="true" spellcheck="true" data-bind="${path}"${single ? " data-single" : ""} data-ph="${escapeHtml(ph)}">${escapeHtml(value)}</div>`;
}

function caseCard(si, ci) {
    const c = App.state.suite.sections[si].cases[ci];
    const base = `suite.sections.${si}.cases.${ci}`;
    const status = caseStatus(c);
    return `
        <article class="case" data-case="${si}.${ci}">
            <div class="case-head">
                <input type="checkbox" class="case-select" data-select="${c.uid || ""}" ${App.selected.has(c.uid) ? "checked" : ""} title="Select for Smart" aria-label="Select ${escapeHtml(c.id)} for Smart">
                ${editable(base + ".id", c.id, { single: true, cls: "case-id mono" })}
                <select class="imp imp-${c.importance.toLowerCase()}" data-bind="${base}.importance" aria-label="Importance">
                    ${IMPORTANCE.map(v => `<option ${v === c.importance ? "selected" : ""}>${v}</option>`).join("")}
                </select>
                <span class="pill pill-${STATUS_CLASS[status]}">${status}</span>
                <span class="spacer"></span>
                <button type="button" class="icon-btn" data-dup="${si}.${ci}" title="Duplicate" aria-label="Duplicate case">
                    <svg viewBox="0 0 24 24" width="16" height="16"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button type="button" class="icon-btn danger" data-del-case="${si}.${ci}" title="Delete" aria-label="Delete case">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                </button>
            </div>
            ${editable(base + ".description", c.description, { ph: "Verify …", cls: "case-desc" })}
            <div class="case-meta">
                <div><span class="label">Preconditions</span>${editable(base + ".pre", c.pre, { ph: "Add preconditions" })}</div>
                <div><span class="label">Test Data</span>${editable(base + ".data", c.data, { ph: NO_DATA })}</div>
                <div class="case-evidence${caseStatus(c) === "Pass" && !(c.evidence || "").trim() && !(App.state.project.evidence || "").trim() ? " missing" : ""}"><span class="label">Execution evidence</span>${editable(base + ".evidence", c.evidence || "", { ph: (App.state.project.evidence || "").trim() ? "Uses the run evidence: " + App.state.project.evidence : "Build, tester and date, or a link to the run — needed for Pass" })}</div>
            </div>
            <div class="steps-wrap">
                <table class="steps">
                    <thead><tr><th class="n">#</th><th>Test Step</th><th>Expected Result</th><th>Actual Result</th><th class="st-col">Status</th><th class="x"></th></tr></thead>
                    <tbody>
                        ${c.steps.map((s, k) => `
                        <tr>
                            <td class="n">${k + 1}</td>
                            <td data-label="Test step">${editable(`${base}.steps.${k}.action`, s.action, { ph: "Step" })}</td>
                            <td data-label="Expected result">${editable(`${base}.steps.${k}.expected`, s.expected, { ph: "… should …" })}</td>
                            <td data-label="Actual result">${editable(`${base}.steps.${k}.actual`, s.actual, { ph: "—", cls: "actual" })}</td>
                            <td class="st-col"><select class="st st-${STATUS_CLASS[s.status] || "untested"}" data-bind="${base}.steps.${k}.status" aria-label="Step ${k + 1} status">
                                ${STATUSES.map(v => `<option ${v === s.status ? "selected" : ""}>${v}</option>`).join("")}
                            </select></td>
                            <td class="x"><button type="button" class="row-x" data-del-step="${si}.${ci}.${k}" title="Remove step" aria-label="Remove step ${k + 1}">✕</button></td>
                        </tr>`).join("")}
                    </tbody>
                </table>
            </div>
            <button type="button" class="add-step" data-add-step="${si}.${ci}">+ Add step</button>
        </article>`;
}

function sectionMeta(section) {
    const s = { Pass: 0, Fail: 0, Blocked: 0 };
    section.cases.forEach(c => { const st = caseStatus(c); if (st in s) s[st]++; });
    return `${section.cases.length} case${section.cases.length === 1 ? "" : "s"}` +
        (s.Pass ? ` · <b class="t-pass">${s.Pass} passed</b>` : "") +
        (s.Fail ? ` · <b class="t-fail">${s.Fail} failed</b>` : "") +
        (s.Blocked ? ` · <b class="t-blocked">${s.Blocked} blocked</b>` : "");
}

function renderCases() {
    renderSectionFilter();
    const sections = App.state.suite.sections;
    const root = $("suite");

    if (!sections.length) {
        root.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28"><path d="M9 11l2.2 2.2L15.5 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
                </div>
                <h2>No test cases yet</h2>
                <p>Describe the feature in Setup and generate, import an existing workbook, or ask the Assistant.</p>
                <div class="empty-actions">
                    <button class="btn btn-primary" data-go="setup">Go to Setup</button>
                    <button class="btn" data-file="import">Import workbook</button>
                    <button class="btn" data-file="sample">Load sample</button>
                </div>
            </div>`;
        return;
    }

    const active = filtersActive();
    let shown = 0;
    root.innerHTML = sections.map((section, si) => {
        if (fSection.value && section.code !== fSection.value) return "";
        const visible = section.cases.map((c, ci) => ci).filter(ci => caseMatches(section.cases[ci]));
        if (active && !visible.length) return "";
        shown += visible.length;
        const collapsed = App.collapsed.has(section.code) && !caseSearch.value.trim();
        return `
            <section class="sec ${collapsed ? "collapsed" : ""}" data-sec="${si}">
                <header class="sec-head">
                    <button type="button" class="sec-toggle" data-toggle-sec="${escapeHtml(section.code)}" aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(section.code)}" aria-expanded="${!collapsed}">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <span class="sec-code mono">${escapeHtml(section.code)}</span>
                    ${editable(`suite.sections.${si}.title`, section.title, { single: true, cls: "sec-title", ph: "Section title" })}
                    <span class="sec-meta" id="secMeta${si}">${sectionMeta(section)}</span>
                    <button type="button" class="btn btn-sm btn-onbrand" data-add-case="${si}">+ Case</button>
                    <button type="button" class="icon-btn on-brand" data-del-sec="${si}" title="Delete section" aria-label="Delete section ${escapeHtml(section.code)}">✕</button>
                </header>
                <div class="sec-body">
                    ${collapsed ? "" : visible.map(ci => caseCard(si, ci)).join("")}
                </div>
            </section>`;
    }).join("") || `<div class="empty-state small"><p>No test cases match the filters.</p></div>`;

    void shown;
}

function refreshCase(si, ci) {
    const card = document.querySelector(`[data-case="${si}.${ci}"]`);
    if (card) {
        const scroll = window.scrollY;
        card.outerHTML = caseCard(si, ci);
        window.scrollTo(0, scroll);
    }
    const meta = $("secMeta" + si);
    if (meta) meta.innerHTML = sectionMeta(App.state.suite.sections[si]);
}

$("suite").addEventListener("click", event => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const sections = App.state.suite.sections;
    const parse = v => v.split(".").map(Number);

    if (btn.dataset.toggleSec !== undefined) {
        const code = btn.dataset.toggleSec;
        App.collapsed.has(code) ? App.collapsed.delete(code) : App.collapsed.add(code);
        renderCases();
        return;
    }
    if (btn.dataset.addCase !== undefined) {
        const section = sections[Number(btn.dataset.addCase)];
        App.snapshot("Add case");
        const module = App.state.modules.find(m => m.code.toUpperCase() === section.code);
        section.cases.push({
            id: nextId(section), importance: "Medium", description: "", pre: (module && module.precondition) || App.state.project.basePre || "",
            data: NO_DATA, steps: [{ action: "", expected: "", actual: "", status: "Untested" }],
        });
        App.collapsed.delete(section.code);
        App.afterChange();
        const cards = document.querySelectorAll(`[data-sec="${btn.dataset.addCase}"] .case`);
        const card = cards[cards.length - 1];
        if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.querySelector(".case-desc").focus(); }
        return;
    }
    if (btn.dataset.delSec !== undefined) {
        const section = sections[Number(btn.dataset.delSec)];
        App.snapshot("Delete section");
        sections.splice(Number(btn.dataset.delSec), 1);
        App.afterChange();
        App.toast(`Deleted section ${section.code} (${section.cases.length} cases).`, true);
        return;
    }
    if (btn.dataset.dup !== undefined) {
        const [si, ci] = parse(btn.dataset.dup);
        App.snapshot("Duplicate case");
        const copy = structuredClone(sections[si].cases[ci]);
        copy.steps.forEach(s => { s.status = "Untested"; s.actual = ""; });
        sections[si].cases.splice(ci + 1, 0, copy);
        renumberSection(sections[si], App.state.project);   // IDs stay sequential and gap-free
        App.afterChange();
        App.toast(`Created ${copy.id}.`);
        return;
    }
    if (btn.dataset.delCase !== undefined) {
        const [si, ci] = parse(btn.dataset.delCase);
        App.snapshot("Delete case");
        const [removed] = sections[si].cases.splice(ci, 1);
        if (!sections[si].cases.length) sections.splice(si, 1);
        else renumberSection(sections[si], App.state.project);   // the rest of the module is renumbered (v3)
        App.afterChange();
        App.toast(`Deleted ${removed.id}; the rest of ${sections[si] ? sections[si].code : "the module"} was renumbered.`, true);
        return;
    }
    if (btn.dataset.addStep !== undefined) {
        const [si, ci] = parse(btn.dataset.addStep);
        App.snapshot("Add step");
        sections[si].cases[ci].steps.push({ action: "", expected: "", actual: "", status: "Untested" });
        refreshCase(si, ci);
        App.save();
        const rows = document.querySelectorAll(`[data-case="${si}.${ci}"] tbody tr`);
        rows[rows.length - 1].querySelector(".ce").focus();
        return;
    }
    if (btn.dataset.delStep !== undefined) {
        const [si, ci, k] = parse(btn.dataset.delStep);
        const c = sections[si].cases[ci];
        App.snapshot("Remove step");
        c.steps.splice(k, 1);
        if (!c.steps.length) c.steps.push({ action: "", expected: "", actual: "", status: "Untested" });
        refreshCase(si, ci);
        App.save();
    }
});

document.addEventListener("click", event => {
    const go = event.target.closest("[data-go]");
    if (go) switchTab(go.dataset.go);
});

$("collapseBtn").addEventListener("click", () => {
    const sections = App.state.suite.sections;
    const allCollapsed = sections.length && sections.every(s => App.collapsed.has(s.code));
    App.collapsed.clear();
    if (!allCollapsed) sections.forEach(s => App.collapsed.add(s.code));
    $("collapseBtn").textContent = allCollapsed ? "Collapse all" : "Expand all";
    renderCases();
});

$("renumberBtn").addEventListener("click", () => {
    if (!App.state.suite.sections.length) return;
    App.snapshot("Renumber IDs");
    numberCases(App.state.suite, App.state.project);
    App.afterChange();
    App.toast("IDs renumbered from 001 in every section.", true);
});

$("undoBtn").addEventListener("click", () => {
    const label = (App.undoStack[App.undoStack.length - 1] || {}).label;
    if (App.undo()) App.toast("Undone: " + label);
});

// ================= Dashboard =================

function suiteStats() {
    const rows = App.state.suite.sections.map(section => {
        const s = { code: section.code, name: section.name, total: section.cases.length, Pass: 0, Fail: 0, Blocked: 0, steps: 0 };
        section.cases.forEach(c => { const st = caseStatus(c); if (st in s) s[st]++; s.steps += c.steps.length; });
        s.Untested = s.total - s.Pass - s.Fail - s.Blocked;
        return s;
    });
    const total = rows.reduce((t, r) => {
        ["total", "Pass", "Fail", "Blocked", "Untested", "steps"].forEach(k => { t[k] += r[k]; });
        return t;
    }, { total: 0, Pass: 0, Fail: 0, Blocked: 0, Untested: 0, steps: 0 });
    return { rows, total };
}

function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) + "%" : "—";
}

function renderDashboard() {
    fillBindings($("tab-dashboard"));
    renderDashboardStats();
}

function renderDashboardStats() {
    const { rows, total } = suiteStats();
    const executed = total.Pass + total.Fail + total.Blocked;

    $("kpis").innerHTML = [
        ["Total cases", total.total, "", `${total.steps} steps`],
        ["Passed", total.Pass, "pass", pct(total.Pass, total.total)],
        ["Failed", total.Fail, "fail", pct(total.Fail, total.total)],
        ["Blocked", total.Blocked, "blocked", pct(total.Blocked, total.total)],
        ["Untested", total.Untested, "untested", pct(total.Untested, total.total)],
        ["Pass rate", pct(total.Pass, total.total), "rate", `${executed} of ${total.total} executed`],
    ].map(([label, value, cls, sub]) => `
        <div class="kpi kpi-${cls}">
            <span class="kpi-label">${label}</span>
            <strong>${value}</strong>
            <span class="kpi-sub">${sub}</span>
        </div>`).join("");

    $("moduleTable").innerHTML = `
        <thead><tr><th>Module / Epic</th><th>Total Cases</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Untested</th><th>Pass Rate</th><th class="bar-col">Progress</th></tr></thead>
        <tbody>
            ${rows.length ? rows.map(r => `
                <tr>
                    <td>${escapeHtml(r.name)} <span class="mono muted">(${escapeHtml(r.code)})</span></td>
                    <td>${r.total}</td><td class="t-pass">${r.Pass}</td><td class="t-fail">${r.Fail}</td><td class="t-blocked">${r.Blocked}</td><td>${r.Untested}</td>
                    <td>${pct(r.Pass, r.total)}</td>
                    <td class="bar-col">${progressBar(r)}</td>
                </tr>`).join("") : `<tr><td colspan="8" class="muted">No test cases yet.</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td>TOTAL</td><td>${total.total}</td><td>${total.Pass}</td><td>${total.Fail}</td><td>${total.Blocked}</td><td>${total.Untested}</td><td>${pct(total.Pass, total.total)}</td><td class="bar-col">${progressBar(total)}</td></tr></tfoot>` : ""}`;

    $("donut").innerHTML = donut([
        ["Passed", total.Pass, "var(--pass)"],
        ["Failed", total.Fail, "var(--fail)"],
        ["Blocked", total.Blocked, "var(--blocked)"],
        ["Untested", total.Untested, "var(--untested)"],
    ], total.total);
}

function progressBar(r) {
    if (!r.total) return "";
    const seg = (n, cls) => n ? `<span class="seg seg-${cls}" style="width:${(n / r.total) * 100}%"></span>` : "";
    return `<div class="bar" title="${r.Pass} passed, ${r.Fail} failed, ${r.Blocked} blocked, ${r.Untested} untested">${seg(r.Pass, "pass")}${seg(r.Fail, "fail")}${seg(r.Blocked, "blocked")}${seg(r.Untested, "untested")}</div>`;
}

function donut(parts, total) {
    const r = 54;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const arcs = total ? parts.filter(p => p[1]).map(([label, n, color]) => {
        const len = (n / total) * circ;
        const gap = parts.filter(p => p[1]).length > 1 ? 2 : 0;
        const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="18" stroke-dasharray="${Math.max(0, len - gap)} ${circ}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${label}: ${n}</title></circle>`;
        offset += len;
        return arc;
    }).join("") : "";
    return `
        <div class="donut">
            <svg viewBox="0 0 140 140" width="168" height="168" role="img" aria-label="Execution status">
                <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--track)" stroke-width="18"/>
                ${arcs}
                <text x="70" y="68" text-anchor="middle" class="donut-num">${total}</text>
                <text x="70" y="86" text-anchor="middle" class="donut-cap">cases</text>
            </svg>
            <ul class="legend">
                ${parts.map(([label, n, color]) => `<li><span class="dot" style="background:${color}"></span>${label}<b>${n}</b><em>${pct(n, total)}</em></li>`).join("")}
            </ul>
        </div>`;
}

// ================= Test Data =================

function renderData() {
    const data = App.state.data;
    $("dataTable").innerHTML = `
        <thead><tr><th class="n">#</th><th>Category</th><th>Data Item</th><th>Value</th><th>Used By (Test Case IDs)</th><th>Notes</th><th class="x"></th></tr></thead>
        <tbody>
            ${data.map((d, i) => {
                const used = usedBy(d.item, App.state.suite);
                return `
                <tr>
                    <td class="n">${i + 1}</td>
                    <td>${editable(`data.${i}.category`, d.category, { ph: "Category" })}</td>
                    <td>${editable(`data.${i}.item`, d.item, { ph: "Data item", cls: "strong" })}</td>
                    <td>${editable(`data.${i}.value`, d.value, { ph: "Value" })}</td>
                    <td class="used mono">${used.length ? escapeHtml(used.join(", ")) : d.category === "Environment" ? '<span class="muted">All cases</span>' : '<span class="warn" title="No case uses this item yet — it is left out of the export">Not used</span>'}</td>
                    <td>${editable(`data.${i}.notes`, d.notes, { ph: "—" })}</td>
                    <td class="x"><button type="button" class="row-x" data-del-data="${i}" aria-label="Remove ${escapeHtml(d.item)}">✕</button></td>
                </tr>`;
            }).join("")}
        </tbody>`;
}

$("dataTable").addEventListener("click", event => {
    const btn = event.target.closest("[data-del-data]");
    if (!btn) return;
    App.snapshot("Remove test data");
    const [removed] = App.state.data.splice(Number(btn.dataset.delData), 1);
    App.afterChange();
    App.toast(`Removed "${removed.item}".`, true);
});

$("dataTable").addEventListener("focusout", event => {
    if (event.target.closest('[data-bind$=".item"]')) setTimeout(renderData, 0);
    renderCounts();
});

$("addDataBtn").addEventListener("click", () => {
    App.state.data.push({ category: "", item: "", value: "", notes: "" });
    App.afterChange();
    const rows = document.querySelectorAll("#dataTable tbody tr");
    rows[rows.length - 1].querySelector(".ce").focus();
});

// ================= File menu, import, export =================

const fileMenu = $("fileMenu");
$("fileBtn").addEventListener("click", event => {
    event.stopPropagation();
    fileMenu.hidden = !fileMenu.hidden;
    $("fileBtn").setAttribute("aria-expanded", !fileMenu.hidden);
});
document.addEventListener("click", event => {
    if (!event.target.closest(".menu")) {
        fileMenu.hidden = true;
        $("fileBtn").setAttribute("aria-expanded", "false");
    }
    const item = event.target.closest("[data-file]");
    if (item) {
        fileMenu.hidden = true;
        fileAction(item.dataset.file);
    }
});

function hasWork() {
    return App.state.suite.sections.length > 0 || App.state.modules.some(m => m.scenarios.trim());
}

function fileAction(action) {
    if (action === "reference") {
        if (hasWork() && !confirm("Replace the current project with the reviewed Clock In / Out Revamp reference suite?")) return;
        App.snapshot("Open reference suite");
        History.checkpoint("Before opening the reference suite");
        const keep = { chat: App.state.chat, ai: App.state.ai };
        const ref = structuredClone(CIO_REFERENCE);
        const basis = BASIS.find(b => b.key === "03");
        App.state = normalize({
            project: { ...ref.project, basis: "03", defaultStatus: "Pass", evidence: "Reviewed reference run — QA build, Clock In / Out Revamp, 20/10/2026, QA Team" },
            scope: "changed",
            changeAreas: [
                { area: "Clock-in screen and job code selection", type: "EXISTING-REVAMPED" },
                { area: "Active shift, Switch Job Code and Clock Out with Tip amount", type: "EXISTING-REVAMPED" },
                { area: "Break cards and suggested break", type: "NEW" },
            ],
            surfaces: ["Time Clock device", "Manager web", "Reports"],
            basisText: basis.text,
            modules: ref.modules,
            data: ref.data,
            suite: ref.suite,
            ...keep,
        });
        App.collapsed.clear();
        App.afterChange();
        switchTab("workbook");
        App.state.projectId = newProjectId();
        History.checkpoint("Opened reference suite");
        App.toast(`Reference suite loaded — ${ref.suite.sections.reduce((n, s) => n + s.cases.length, 0)} reviewed cases (${ref.suite.sections.map(s => s.code).join(", ")}).`);
    }
    if (action === "sample") {
        if (hasWork() && !confirm("Replace the current project with the Pending Punch Acknowledgement sample?")) return;
        App.snapshot("Load sample");
        History.checkpoint("Before loading the sample");
        const keepChat = App.state.chat;
        const keepAi = App.state.ai;
        App.state = normalize(structuredClone(SAMPLE_PENDING_ACK));
        App.state.chat = keepChat;
        App.state.ai = keepAi;
        const result = generateSuite(App.state);
        App.state.suite = result.suite;
        App.state.data = result.data;
        App.collapsed.clear();
        App.afterChange();
        switchTab("cases");
        const total = result.suite.sections.reduce((n, s) => n + s.cases.length, 0);
        App.state.projectId = newProjectId();
        History.checkpoint("Loaded sample");
        App.toast(`Sample loaded — ${total} test cases. See Setup for the inputs.`);
    }
    if (action === "upload") {
        switchTab("setup");
        $("s-basis").scrollIntoView({ behavior: "smooth", block: "start" });
        $("sourceInput").click();
    }
    if (action === "import") {
        $("fileInput").accept = ".xlsx";
        $("fileInput").click();
    }
    if (action === "open") {
        $("fileInput").accept = ".json";
        $("fileInput").click();
    }
    if (action === "save") {
        const { chat, ai, ...project } = App.state;
        void chat; void ai;
        download(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), baseName() + ".testcases.json");
    }
    if (action === "history") openHistory();
    if (action === "new") openNewDialog();
}

$("fileInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
        if (/\.json$/i.test(file.name)) {
            const parsed = JSON.parse(await file.text());
            if (hasWork() && !confirm(`Open ${file.name}? The current project will be replaced.`)) return;
            App.snapshot("Open project");
            History.checkpoint("Before opening " + file.name);
            const keep = { chat: App.state.chat, ai: App.state.ai };
            App.state = normalize({ ...parsed, ...keep });
            App.afterChange();
            switchTab(App.state.suite.sections.length ? "cases" : "setup");
            if (!parsed.projectId) App.state.projectId = newProjectId();
            History.checkpoint("Opened " + file.name);
            App.toast(`Opened ${file.name}.`);
        } else {
            const imported = await importWorkbook(await file.arrayBuffer());
            const count = imported.suite.sections.reduce((n, s) => n + s.cases.length, 0);
            if (App.state.suite.sections.length && !confirm(`Replace the current test cases with ${count} cases from ${file.name}?`)) return;
            App.snapshot("Import workbook");
            History.checkpoint("Before importing " + file.name);
            Object.assign(App.state.project, Object.fromEntries(Object.entries(imported.project).filter(([, v]) => v)));
            if (!App.state.project.name) App.state.project.name = file.name.replace(/\.xlsx$/i, "").replace(/_/g, " ");
            App.state.suite = imported.suite;
            if (imported.data.length) App.state.data = imported.data;
            App.collapsed.clear();
            App.afterChange();
            switchTab("cases");
            App.state.projectId = newProjectId();
            History.checkpoint("Imported " + file.name);
            App.toast(`Imported ${count} test cases in ${imported.suite.sections.length} sections from ${file.name}.`, true);
        }
    } catch (error) {
        console.error(error);
        App.toast("Couldn't open the file: " + error.message);
    }
});

// File name: the enhancement name with underscores, e.g. Clock_In_Out_Revamp
function baseName() {
    const file = (App.state.project.fileName || "").trim().replace(/\.xlsx$/i, "");
    const name = file || App.state.project.name.replace(/^.*[—–]\s*/, "").trim() || "Test_Cases";
    return name.replace(/[^\w\- ]+/g, "").trim().replace(/[\s\-]+/g, "_");
}

function download(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

$("exportBtn").addEventListener("click", () => {
    const { suite, project, data } = App.state;
    if (!suite.sections.length) {
        App.toast("Generate or import test cases first.");
        return;
    }
    try {
        download(buildWorkbook(project, suite, data, workbookMeta(App.state)), baseName() + ".xlsx");
        const total = suite.sections.reduce((n, s) => n + s.cases.length, 0);
        const { errors } = checkSuite(App.state);
        if (errors.length) {
            App.toast(`Exported ${total} test cases — ${errors.length} Standard v3 issue${errors.length === 1 ? "" : "s"} to fix. Open Check for the list.`);
        } else {
            App.toast(`Exported ${total} test cases. Standard v3 check: PASS.`);
        }
    } catch (error) {
        console.error(error);
        App.toast("Export failed: " + error.message);
    }
});

// ================= Standard v3 check =================

function updateIssueCount() {
    const badge = $("issueCount");
    const chip = $("checkBtn");
    if (!App.state.suite.sections.length) {
        badge.textContent = "0"; badge.className = "count"; badge.hidden = true;
        chip.dataset.state = "empty";
        chip.disabled = true;
        chip.querySelector(".status-text").textContent = "No cases yet";
        chip.title = "Generate or import test cases first";
        return;
    }
    const { errors, warnings } = checkSuite(App.state);
    chip.disabled = false;
    badge.hidden = !(errors.length || warnings.length);
    badge.textContent = errors.length || warnings.length;
    badge.className = "count " + (errors.length ? "count-err" : warnings.length ? "count-warn" : "count-ok");
    chip.dataset.state = errors.length ? "err" : warnings.length ? "warn" : "ok";
    chip.querySelector(".status-text").textContent = errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : warnings.length ? `Passes · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "Standard check passed";
    $("checkBtn").title = errors.length ? `${errors.length} errors, ${warnings.length} warnings` : warnings.length ? `${warnings.length} warnings` : "Standard v3 check: PASS";
}

function openCheck() {
    const { errors, warnings, toConfirm } = checkSuite(App.state);
    const total = App.state.suite.sections.reduce((n, s) => n + s.cases.length, 0);
    $("checkSummary").innerHTML = errors.length
        ? `<b class="t-fail">FAIL</b> · ${errors.length} error${errors.length === 1 ? "" : "s"} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"} · ${total} cases · ${toConfirm} "To confirm:" results`
        : `<b class="t-pass">PASS</b> · ${warnings.length} warning${warnings.length === 1 ? "" : "s"} · ${total} cases · ${toConfirm} "To confirm:" results`;

    const group = (list, cls) => {
        const byId = new Map();
        list.forEach(i => { if (!byId.has(i.id)) byId.set(i.id, []); byId.get(i.id).push(i); });
        return [...byId.entries()].map(([id, items]) => `
            <div class="issue ${cls}">
                <button type="button" class="issue-id mono" data-goto="${escapeHtml(id)}">${escapeHtml(id)}</button>
                <ul>${items.map(i => `<li><span class="issue-field">${escapeHtml(i.field)}</span>${escapeHtml(i.msg)}</li>`).join("")}</ul>
            </div>`).join("");
    };
    $("checkBody").innerHTML = (errors.length || warnings.length)
        ? (errors.length ? `<h3>Errors</h3>${group(errors, "err")}` : "") + (warnings.length ? `<h3>Warnings</h3>${group(warnings, "warn")}` : "")
        : `<p class="check-pass">Every item on the Standard v3 pre-delivery checklist passes.</p>`;
    $("checkDialog").showModal();
}

$("checkBtn").addEventListener("click", openCheck);
$("suite").addEventListener("focusout", () => updateIssueCount());
$("checkClose").addEventListener("click", () => $("checkDialog").close());
$("checkDone").addEventListener("click", () => $("checkDialog").close());
$("checkRenumber").addEventListener("click", () => {
    App.snapshot("Renumber IDs");
    numberCases(App.state.suite, App.state.project);
    App.afterChange();
    openCheck();
});
$("checkBody").addEventListener("click", event => {
    const btn = event.target.closest("[data-goto]");
    if (!btn) return;
    $("checkDialog").close();
    App.setSearch(btn.dataset.goto);
});

// ================= Assistant panel =================

function setAssistant(open, focus = true) {
    document.body.classList.toggle("assistant-open", open);
    $("assistantBtn").setAttribute("aria-pressed", open);
    try { localStorage.setItem(PANEL_KEY, open ? "1" : "0"); } catch (e) { /* ignore */ }
    if (open && focus) setTimeout(() => $("chatInput").focus(), 50);
}

$("assistantBtn").addEventListener("click", () => setAssistant(!document.body.classList.contains("assistant-open")));
$("assistantClose").addEventListener("click", () => setAssistant(false));


// ================= Start =================

// Sticky toolbars, the Assistant and the workbook sit under the top bar, whose height changes when it wraps
function syncTopbar() {
    const root = document.documentElement.style;
    root.removeProperty("--topbar");                                   // back to the 64px default, then measure
    const height = document.querySelector(".topbar").offsetHeight;
    if (height !== 64) root.setProperty("--topbar", height + "px");
}
window.addEventListener("resize", syncTopbar);

(function start() {
    try {
        App.state = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
        App.state = defaultState();
    }
    // The Assistant stays closed until the tester opens it; after that, the last choice is remembered
    let open = false;
    try {
        const saved = localStorage.getItem(PANEL_KEY);
        if (saved !== null) open = saved === "1";
    } catch (e) { /* ignore */ }

    SmartSettings.init();
    Chat.init();
    SmartReview.init();
    SmartCommands.init();
    initSourcesUi();
    VideoViewer.init();
    initRules();
    initIntake();
    initWorkbook();
    initHistoryUi();
    if (!App.state.projectId) App.state.projectId = newProjectId();
    Sources.load().then(() => { renderSources(); renderGenerateHint(); });
    setAssistant(open, false);
    renderCounts();
    updateUndoButton();
    switchTab(App.state.tab || "setup");
    syncTopbar();
})();