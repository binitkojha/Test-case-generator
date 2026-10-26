// ---------- Format & rules ----------
// One place for the team's test case format: the team format (editable, built into the generator and export), the
// team's own rules and generation ideas, and the reviewed cases Smart copies for style. Saved explicitly in this
// browser for every suite, and shared as a rules pack file.

const RULES_KEY = "tcg-rules";
const MAX_EXAMPLES = 12;

const Rules = {
    format: TEAM_FORMAT,
    teamRules: "",
    examplesList: null,          // null = the built-in reviewed reference cases
    examplesFrom: "",
    updatedAt: "",

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(RULES_KEY)) || {};
            this.format = typeof saved.format === "string" && saved.format.trim() ? saved.format : TEAM_FORMAT;
            this.teamRules = saved.teamRules || "";
            this.examplesList = Array.isArray(saved.examples) ? saved.examples : null;
            this.examplesFrom = saved.examplesFrom || "";
            this.updatedAt = saved.updatedAt || "";
        } catch (e) { /* defaults */ }
    },
    save() {
        this.updatedAt = new Date().toISOString();
        try { localStorage.setItem(RULES_KEY, JSON.stringify(this.pack())); } catch (e) { /* memory only */ }
    },

    examples() {
        return this.examplesList || referenceExamples();
    },
    source() {
        return this.examplesList ? (this.examplesFrom || "your reviewed workbook") : "Clock_In_Out_Revamp.xlsx (built-in reference)";
    },

    pack() {
        return { type: "tcg-rules", version: 2, format: this.format, teamRules: this.teamRules, examples: this.examplesList, examplesFrom: this.examplesFrom, updatedAt: this.updatedAt };
    },
    applyPack(p) {
        if (!p || p.type !== "tcg-rules") throw new Error("this is not a rules pack exported from the Test Case Generator");
        if (typeof p.format === "string" && p.format.trim()) this.format = p.format;
        this.teamRules = String(p.teamRules || "");
        this.examplesList = Array.isArray(p.examples) && p.examples.length ? p.examples.slice(0, MAX_EXAMPLES) : null;
        this.examplesFrom = this.examplesList ? String(p.examplesFrom || "shared rules pack") : "";
        this.save();
    },
};

// Lines of the team format (normalised) — rules that repeat them are already built in
function formatLines() {
    const norm = s => s.toLowerCase().replace(/^[\s\-*•\d.)]+/, "").replace(/[^a-z0-9]+/g, " ").trim();
    const set = new Set(String(Rules.format || "").split("\n").map(norm).filter(l => l.length > 12));
    return { has: line => set.has(norm(line)) };
}

// A spread of reviewed cases from an imported workbook: up to two per module, the most detailed first
function pickExamples(suite) {
    const picked = [];
    for (let section of suite.sections) {
        const best = section.cases.slice()
            .sort((a, b) => (b.steps.length - a.steps.length) || ((b.description || "").length - (a.description || "").length))
            .slice(0, 2);
        for (let c of best) picked.push({ module: section.code, ...c });
    }
    return picked.slice(0, MAX_EXAMPLES);
}

// The text Smart receives with every request (lines that repeat the team format are left out)
function teamRulesText() {
    const inFormat = formatLines();
    const rules = Rules.teamRules.split("\n").filter(l => !inFormat.has(l)).join("\n").trim();
    return rules ? `TEAM RULES AND GENERATION IDEAS (from the QA team — follow them together with the team format)\n${rules}` : "";
}

// ---------- Format guide (Markdown, for sharing) ----------

function formatGuideMarkdown() {
    const cell = v => String(v || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    const examples = Rules.examples();
    return `# Test case format

Shared from the Test Case Generator on ${new Date().toLocaleDateString()}.

## Generating test cases

1. Add what changed: release notes, specs, slides, PDFs, screenshots, screen recordings — or paste the details.
2. Generate, then confirm the intake: change areas (New / Existing-revamped), surfaces, design material, scope and the suite prefix.
3. Review the cases and the team-format check, then export the .xlsx (Dashboard · Sheet1 · Test Data).

## Team format

\`\`\`
${String(Rules.format || "").trim()}
\`\`\`

${Rules.teamRules.trim() ? `## Team rules and generation ideas\n\n${Rules.teamRules.trim()}\n\n` : ""}## Style examples

From ${Rules.source()}.

| Module | ID | Importance | Description | Steps | Expected result |
|---|---|---|---|---|---|
${examples.map(c => `| ${cell(c.module)} | ${cell(c.id)} | ${cell(c.importance)} | ${cell(c.description)} | ${cell(c.steps.map((s, i) => `${i + 1}. ${s.action}`).join("\n"))} | ${cell(c.steps.map((s, i) => `${i + 1}. ${s.expected}`).join("\n"))} |`).join("\n")}

## The Altametrics standard (base)

\`\`\`
${STANDARD_V3.trim()}
\`\`\`
`;
}

// ---------- Tab ----------

// Unsaved edits live in the two text boxes until Save
function rulesDirty() {
    return $("teamFormat").value !== Rules.format || $("teamRules").value !== Rules.teamRules;
}

function renderSaveState() {
    const dirty = rulesDirty();
    const state = $("rulesSaveState");
    state.textContent = dirty ? "Unsaved changes" : Rules.updatedAt ? `Saved ${timeAgo(Rules.updatedAt)}` : "Not saved yet";
    state.className = "save-state " + (dirty ? "dirty" : "clean");
    $("rulesSave").disabled = !dirty;
    $("formatReset").disabled = $("teamFormat").value === TEAM_FORMAT;
}

function saveRules({ quiet = false } = {}) {
    if (!rulesDirty()) return false;
    Rules.format = $("teamFormat").value.trim() ? $("teamFormat").value : TEAM_FORMAT;
    Rules.teamRules = $("teamRules").value;
    Rules.save();
    renderRules();
    if (!quiet) App.toast("Format & rules saved — the next Generate uses them.");
    return true;
}

function renderRules() {
    const box = $("teamRules");
    if (!rulesDirty() || !box.value) box.value = Rules.teamRules;
    const fmt = $("teamFormat");
    if (!rulesDirty() || !fmt.value) fmt.value = Rules.format;
    renderRulesPreview();
    renderSaveState();
    $("rulesSaved").textContent = "";
    $("standardText").textContent = STANDARD_V3.trim();
    const examples = Rules.examples();
    $("examplesFrom").textContent = `${examples.length} case${examples.length === 1 ? "" : "s"} from ${Rules.source()}`;
    $("examplesReset").hidden = !Rules.examplesList;
    $("examplesList").innerHTML = examples.map((c, i) => `
        <div class="example">
            <div class="example-head">
                <span class="pill">${escapeHtml(c.module)}</span>
                <span class="mono">${escapeHtml(c.id || "")}</span>
                <span class="muted">${escapeHtml(c.importance || "")}</span>
                <span class="spacer"></span>
                ${Rules.examplesList ? `<button type="button" class="icon-btn danger" data-example-drop="${i}" title="Remove this example" aria-label="Remove example ${i + 1}">✕</button>` : ""}
            </div>
            <p class="example-title">${escapeHtml(c.description || "")}</p>
            <ol>${c.steps.map(s => `<li><span>${escapeHtml(s.action)}</span><em>${escapeHtml(s.expected)}</em></li>`).join("")}</ol>
        </div>`).join("");
}

function initRules() {
    Rules.load();
    $("teamFormat").value = Rules.format;
    $("teamRules").value = Rules.teamRules;
    $("teamRules").addEventListener("input", () => { renderRulesPreview(); renderSaveState(); });
    $("teamFormat").addEventListener("input", () => { renderRulesPreview(); renderSaveState(); });
    $("rulesSave").addEventListener("click", () => saveRules());
    $("formatReset").addEventListener("click", () => {
        if (!confirm("Replace the team format text with the default the app shipped with? Save to keep it.")) return;
        $("teamFormat").value = TEAM_FORMAT;
        renderRulesPreview();
        renderSaveState();
    });
    // Ctrl+S saves while on this page
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && App.state.tab === "rules") {
            e.preventDefault();
            if (!saveRules()) App.toast("Nothing to save.");
        }
    });
    // Leaving the page or the browser with unsaved edits
    window.addEventListener("beforeunload", e => { if (rulesDirty()) { e.preventDefault(); e.returnValue = ""; } });

    // Style examples from a reviewed workbook
    $("examplesUpload").addEventListener("click", () => $("examplesInput").click());
    $("examplesInput").addEventListener("change", async () => {
        const file = $("examplesInput").files[0];
        $("examplesInput").value = "";
        if (!file) return;
        try {
            const imported = await importWorkbook(await file.arrayBuffer());
            const picked = pickExamples(imported.suite);
            if (!picked.length) throw new Error("no test cases found in it");
            Rules.examplesList = picked;
            Rules.examplesFrom = file.name;
            Rules.save();
            renderRules();
            App.toast(`${picked.length} reviewed cases from ${file.name} are now the style examples.`);
        } catch (e) {
            App.toast(`Could not read ${file.name} — ${e.message}`);
        }
    });
    $("examplesReset").addEventListener("click", () => {
        Rules.examplesList = null;
        Rules.examplesFrom = "";
        Rules.save();
        renderRules();
    });
    $("examplesList").addEventListener("click", e => {
        const drop = e.target.closest("[data-example-drop]");
        if (!drop) return;
        Rules.examplesList.splice(Number(drop.dataset.exampleDrop), 1);
        if (!Rules.examplesList.length) { Rules.examplesList = null; Rules.examplesFrom = ""; }
        Rules.save();
        renderRules();
    });

    // Sharing (unsaved edits are saved first, so the pack matches what you see)
    $("rulesExport").addEventListener("click", () => {
        saveRules({ quiet: true });
        download(new Blob([JSON.stringify(Rules.pack(), null, 2)], { type: "application/json" }), "Test_Case_Rules.json");
        App.toast("Rules pack downloaded — teammates import it on their Format & rules page.");
    });
    $("rulesImport").addEventListener("click", () => $("rulesInput").click());
    $("rulesInput").addEventListener("change", async () => {
        const file = $("rulesInput").files[0];
        $("rulesInput").value = "";
        if (!file) return;
        try {
            const pack = JSON.parse(await file.text());
            if ((Rules.teamRules.trim() || Rules.format !== TEAM_FORMAT || rulesDirty()) && !confirm("Replace your format, team rules and style examples with the ones in this pack?")) return;
            Rules.applyPack(pack);
            $("teamFormat").value = Rules.format;
            $("teamRules").value = Rules.teamRules;
            renderRules();
            App.toast(`Rules from ${file.name} are in use.`);
        } catch (e) {
            App.toast(`Could not import ${file.name} — ${e instanceof SyntaxError ? "the file is not valid JSON" : e.message}`);
        }
    });
    $("rulesGuide").addEventListener("click", () => {
        download(new Blob([formatGuideMarkdown()], { type: "text/markdown" }), "Test_Case_Format_Guide.md");
    });
    $("rulesCopy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(formatGuideMarkdown());
            App.toast("Format guide copied — paste it into a chat, wiki page or email.");
        } catch (e) {
            App.toast("Copy is blocked in this browser — use Download guide instead.");
        }
    });
}

// ---------- Team rules the Offline engine applies ----------
// Smart reads every rule as text. Offline applies the kinds it can apply exactly:
//   wording       Use "Manager web", never "back office"   ·   "back office" → "Manager web"   ·   Replace "X" with "Y"
//   importance    EDG cases are Low   ·   All REG cases should be High   ·   Importance of RPT cases: High
//   precondition  Every precondition must include "The device is online."
//   extra cases   REG: Verify … [High]   followed by   - Step => … should …   lines (and optional Pre: line)

const QUOTED = '["“]([^"”]+)["”]';

function parseTeamRules(text) {
    const out = { replacements: [], importance: [], preconditions: [], scenarios: [], other: [] };
    let block = null;
    for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
        const t = raw.trim();
        if (!t) { block = null; continue; }
        // Lines that continue an extra case: steps, precondition, data
        if (block && (/^[-*•]\s*.+=>/.test(t) || /^(pre(condition)?s?|data)\s*:/i.test(t))) { block.lines.push(t); continue; }
        block = null;
        const line = t.replace(/^(?:[-*•]|\d+[.)])\s*/, "");
        let m;

        if ((m = /^([A-Z]{2,4})\s*[:\-–—]\s*(Verify\b.+)$/.exec(line))) {
            block = { code: m[1], lines: [m[2]], rule: line };
            out.scenarios.push(block);
            continue;
        }
        const replace = (from, to) => out.replacements.push({ from: from.trim(), to: to.trim(), rule: line });
        if ((m = new RegExp(`\\b(?:use|say|write|call it)\\s+${QUOTED}\\s*,?\\s*(?:and\\s+)?(?:never|not|instead of|rather than|over)\\s+${QUOTED}`, "i").exec(line))) { replace(m[2], m[1]); continue; }
        if ((m = new RegExp(`\\b(?:never|don't|do not)\\s+(?:use|say|write)\\s+${QUOTED}\\s*[,;:—–-]*\\s*(?:instead\\s+)?(?:use|say|write)\\s+${QUOTED}`, "i").exec(line))) { replace(m[1], m[2]); continue; }
        if ((m = new RegExp(`\\b(?:replace|change|rename)\\s+${QUOTED}\\s+(?:with|to|into|by)\\s+${QUOTED}`, "i").exec(line))) { replace(m[1], m[2]); continue; }
        if ((m = new RegExp(`${QUOTED}\\s*(?:->|→|=>)\\s*${QUOTED}`).exec(line))) { replace(m[1], m[2]); continue; }

        const level = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        const scopeOf = s => (/^(all|every|each)$/i.test(s) ? "ALL" : s === s.toUpperCase() ? s : null);
        if ((m = /\b(all|every|each|[A-Za-z]{2,4})\b(?:\s+module)?\s+cases?\s+(?:are|is|should be|must be|get|=|to|have importance|set to)\s+(?:marked\s+|set to\s+)?(?:importance\s+)?(high|medium|low)\b/i.exec(line)) && scopeOf(m[1])) {
            out.importance.push({ scope: scopeOf(m[1]), level: level(m[2]), rule: line });
            continue;
        }
        if ((m = /\bimportance\s+(?:of|for)\s+(all|every|[A-Za-z]{2,4})\s+cases?\s*(?:is|are|=|:|to|should be)?\s*(high|medium|low)\b/i.exec(line)) && scopeOf(m[1])) {
            out.importance.push({ scope: scopeOf(m[1]), level: level(m[2]), rule: line });
            continue;
        }
        if ((m = new RegExp(`\\b(?:every|each|all)\\s+preconditions?\\s+(?:must\\s+|should\\s+)?(include|includes|mention|mentions|add|start with|starts with|begin with|begins with|end with|ends with)\\s*:?\\s*${QUOTED}`, "i").exec(line))) {
            out.preconditions.push({ text: m[2].trim(), start: /start|begin/i.test(m[1]), rule: line });
            continue;
        }
        if ((m = /^(?:add to every precondition|every precondition)\s*:\s*["“]?(.+?)["”]?$/i.exec(line))) {
            out.preconditions.push({ text: m[1].trim(), start: false, rule: line });
            continue;
        }
        out.other.push(line);
    }
    return out;
}

// Extra cases from the team rules go into their module before the suite is built
function withTeamScenarios(state, team) {
    const s = { ...state, modules: state.modules.map(m => ({ ...m })) };
    const skipped = [];
    for (const block of team.scenarios) {
        const text = block.lines.join("\n");
        const module = s.modules.find(m => m.code.toUpperCase() === block.code);
        if (module) module.scenarios = ((module.scenarios || "") + "\n" + text).trim();
        else if (block.code === "RPT") s.reports = ((s.reports || "") + "\n" + text).trim();
        else if (block.code === "REG") s.regression = ((s.regression || "") + "\n" + text).trim();
        else if (block.code === "EDG") s.edgeScenarios = ((s.edgeScenarios || "") + "\n" + text).trim();
        else skipped.push(`${block.code} is not a module of this suite`);
    }
    return { state: s, skipped };
}

function replaceWording(text, from, to) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${/^\w/.test(from) ? "\\b" : ""}${esc}${/\w$/.test(from) ? "\\b" : ""}`, "gi");
    let count = 0;
    const out = text.replace(re, match => {
        count++;
        return /^[A-Z]/.test(match) && /^[a-z]/.test(to) ? to.charAt(0).toUpperCase() + to.slice(1) : to;
    });
    return { text: out, count };
}

// Wording, importance and preconditions on the built suite. Returns what was applied.
function applyTeamRules(suite, team) {
    const applied = [];
    for (const r of team.replacements) {
        let n = 0;
        const fix = (obj, key) => { if (!obj[key]) return; const res = replaceWording(obj[key], r.from, r.to); obj[key] = res.text; n += res.count; };
        for (const sec of suite.sections) {
            fix(sec, "title"); fix(sec, "name");
            for (const c of sec.cases) {
                fix(c, "description"); fix(c, "pre");
                c.steps.forEach(st => { fix(st, "action"); fix(st, "expected"); fix(st, "actual"); });
            }
        }
        applied.push({ rule: r.rule, count: n, what: `"${r.from}" → "${r.to}"` });
    }
    for (const r of team.importance) {
        let n = 0;
        for (const sec of suite.sections) {
            if (r.scope !== "ALL" && sec.code !== r.scope) continue;
            for (const c of sec.cases) if (c.importance !== r.level) { c.importance = r.level; n++; }
        }
        applied.push({ rule: r.rule, count: n, what: `${r.scope === "ALL" ? "All" : r.scope} cases → ${r.level}` });
    }
    for (const r of team.preconditions) {
        let n = 0;
        const sentence = /[.!?]$/.test(r.text) ? r.text : r.text + ".";
        for (const sec of suite.sections) {
            for (const c of sec.cases) {
                if ((c.pre || "").toLowerCase().includes(r.text.toLowerCase().replace(/[.!?]$/, ""))) continue;
                c.pre = r.start ? `${sentence} ${c.pre || ""}`.trim() : `${(c.pre || "").trim()} ${sentence}`.trim();
                n++;
            }
        }
        applied.push({ rule: r.rule, count: n, what: `Precondition: ${sentence}` });
    }
    return applied;
}

// Rules page: what Offline will do with each rule
function renderRulesPreview() {
    const box = $("rulesPreview");
    if (!box) return;
    const team = parseTeamRules($("teamRules").value);
    const inFormat = formatLines();
    const repeats = team.other.filter(l => inFormat.has(l)).length;
    team.other = team.other.filter(l => !inFormat.has(l));
    const offline = [
        ...team.replacements.map(r => `Wording: "${escapeHtml(r.from)}" → "${escapeHtml(r.to)}"`),
        ...team.importance.map(r => `Importance: ${r.scope === "ALL" ? "all" : escapeHtml(r.scope)} cases → ${r.level}`),
        ...team.preconditions.map(r => `Precondition ${r.start ? "starts with" : "includes"}: ${escapeHtml(r.text)}`),
        ...team.scenarios.map(b => `Extra ${escapeHtml(b.code)} case: ${escapeHtml(b.lines[0].replace(/\s*\[(high|medium|low)\]/i, ""))} (${b.lines.length - 1} step${b.lines.length === 2 ? "" : "s"})`),
    ];
    if (!offline.length && !team.other.length && !repeats) { box.innerHTML = ""; return; }
    box.innerHTML = `
        ${repeats ? `<p class="rp-title ok">Already in the team format (${repeats} line${repeats === 1 ? "" : "s"})</p><p class="hint">Built into the generator and the export — no need to repeat them here.</p>` : ""}
        ${offline.length ? `<p class="rp-title ok">Applied by Offline and Smart (${offline.length})</p><ul>${offline.map(x => `<li class="ok">${x}</li>`).join("")}</ul>` : ""}
        ${team.other.length ? `<p class="rp-title">Smart only (${team.other.length})</p><ul>${team.other.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        <p class="hint">To have Offline apply a rule, write it as wording (<code>Use "A", never "B"</code>), importance (<code>EDG cases are Low</code>), a precondition (<code>Every precondition must include "…"</code>) or an extra case (<code>REG: Verify …</code> with <code>- step =&gt; … should …</code> lines).</p>` : ""}`;
}
