// Checks — the Altametrics standard with the team format on top (the team format wins where they differ).
// checkSuite(state) → { errors: [...], warnings: [...], toConfirm } where each issue is { id, field, msg }.

const NOT_VERBS = new Set(["the", "a", "an", "this", "that", "it", "user", "employee", "manager", "system", "page", "screen", "button", "should", "verify"]);
const DOC_UNDER_TEST = DOCUMENT_TEST;              // shared with the generator (generator.js)

function countShould(text) {
    return ((text || "").match(/\bshould\b/gi) || []).length;
}

// ---------- Case validation (team validator) ----------
// validateTestCase(testCase, { prefix, full, evidence }) → { valid, errors }
// testCase uses the app's shape: { id, description, pre, data, steps: [{ action, expected, actual, status }], evidence }.
// "PREFIX" is the suite's real prefix; the CR segment is required for change-scoped suites and absent for full modules.
// A step can only be "Pass" when there is execution evidence — on the case, or for the whole cycle.
function validateTestCase(testCase, { prefix = "", full = false, evidence = "" } = {}) {
    const errors = [];
    const c = testCase || {};
    const steps = Array.isArray(c.steps) ? c.steps : [];
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (!(c.id || "").trim()) errors.push("Missing test case ID");
    const idPattern = prefix
        ? new RegExp(`^${esc(prefix)}_${full ? "" : "CR_"}[A-Z][A-Z0-9]*_\\d{3}$`)
        : new RegExp(`^[A-Z][A-Z0-9]*_${full ? "" : "CR_"}[A-Z][A-Z0-9]*_\\d{3}$`);
    if (!idPattern.test(c.id || "")) errors.push(`Invalid test case ID format — expected ${prefix || "PREFIX"}_${full ? "" : "CR_"}MOD_NNN`);

    if (!/^Verify\b/.test(c.description || "")) errors.push("Description must start with Verify");

    const text = [c.description, ...steps.flatMap(s => [s.action, s.expected])].filter(Boolean).join(" ");
    if (DOCUMENT_TEST.test(text)) errors.push("Possible document-reference test case");

    if (!(c.pre || "").trim()) errors.push("Missing preconditions");
    if (!(c.data || "").trim()) errors.push("Missing concrete test data");
    if (!steps.length || steps.every(s => !(s.action || "").trim())) errors.push("Missing test steps");
    if (!steps.length || steps.some(s => !(s.expected || "").trim())) errors.push("Missing expected result");

    const proof = (c.evidence || "").trim() || (evidence || "").trim();
    if (steps.some(s => s.status === "Pass") && !proof) errors.push("Pass status requires verified execution evidence");

    return { valid: errors.length === 0, errors };
}

// Which case field each validator message belongs to (for the Check list)
const VALIDATOR_FIELD = [
    [/ID/, "ID"], [/Description/, "Description"], [/document-reference/, "Scope"], [/preconditions/, "Preconditions"],
    [/test data/, "Test Data"], [/test steps/, "Steps"], [/expected result/, "Expected"], [/evidence/, "Status"],
];

function checkSuite(state) {
    const errors = [];
    const warnings = [];
    let toConfirm = 0;
    const err = (id, field, msg) => errors.push({ id, field, msg });
    const warn = (id, field, msg) => warnings.push({ id, field, msg });
    const suite = state.suite;
    const seen = new Map();
    const scope = state.scope || "changed";
    const full = scope === "full";
    const codes = suite.sections.map(s => s.code);

    // Module order: functional modules, then UI, API, DB, INT, RPT, REG, EDG
    const tailOrder = Object.keys(TAIL_SECTIONS);
    let lastTail = -1, seenTail = false;
    for (const code of codes) {
        const i = tailOrder.indexOf(code);
        if (i < 0 && seenTail) err(code, "Module order", "Functional modules come before UI, API, DB, INT, RPT, REG and EDG.");
        if (i >= 0) { if (i < lastTail) err(code, "Module order", `Order should be ${tailOrder.join(", ")}.`); lastTail = i; seenTail = true; }
    }
    if (scope === "ui") {
        for (const code of ["API", "DB", "INT"]) if (codes.includes(code)) err(code, "Scope", "UI-only revamp: no API, DB or INT cases.");
        const total = suite.sections.reduce((n, s) => n + s.cases.length, 0);
        if (total && (total < 12 || total > 18)) warn("Suite", "Scope", `UI-only revamps have 12 to 18 high-value cases — this suite has ${total}.`);
    }

    for (let section of suite.sections) {
        const where = section.code;
        if (!/^[A-Z][A-Z0-9]{1,5}$/.test(section.code)) err(where, "Banner", `Module code "${section.code}" should be 2–6 capital letters.`);
        if (!section.title || /^\s/.test(section.title)) err(where, "Banner", "Banner needs a title with no leading space.");

        const prefix = idPrefix(state.project, section.code);
        section.cases.forEach((c, i) => {
            const id = c.id || `${section.code} #${i + 1}`;

            // IDs: PREFIX_MOD_NNN (full module) or PREFIX_CR_MOD_NNN (change-scoped), 3 digits, gap-free, never reused
            const expectedId = prefix + "_" + String(i + 1).padStart(3, "0");
            if (!/^[A-Z0-9]+(_[A-Z0-9]+)*_\d{3}$/.test(c.id)) err(id, "ID", `ID should look like ${full ? "PREFIX_MOD_NNN" : "PREFIX_CR_MOD_NNN"} with 3 digits.`);
            else if (c.id !== expectedId) err(id, "ID", `ID out of sequence — expected ${expectedId}. Use Renumber IDs.`);
            if (full && /_CR_/.test(c.id)) err(id, "ID", "Full-module suites use PREFIX_MOD_NNN — no CR segment.");
            if (!full && !/_CR_/.test(c.id)) err(id, "ID", "Change-scoped suites use PREFIX_CR_MOD_NNN.");
            if (seen.has(c.id)) err(id, "ID", "Duplicate ID.");
            seen.set(c.id, true);

            if (!["High", "Medium", "Low"].includes(c.importance)) err(id, "Importance", "Importance should be High, Medium or Low.");

            const d = (c.description || "").trim();
            if (!/^Verify\b/.test(d)) err(id, "Description", 'Description should start with "Verify".');
            if (!/\.$/.test(d)) warn(id, "Description", "Description should be one sentence ending with a period.");
            if ((d.match(/\.\s+[A-Z]/g) || []).length) warn(id, "Description", "Description should target a single condition in one sentence.");

            const all = [d, c.pre, ...c.steps.flatMap(s => [s.action, s.expected])].join(" ");
            if (DOC_UNDER_TEST.test(all)) err(id, "Scope", "The uploaded document is a reference, never the system under test — test the application.");
            else if (emptySubject(d)) err(id, "Description", "Description has no real subject — say which screen, field or message is verified.");

            // Team validator: required parts and execution evidence for Pass (ID, Verify and document checks are reported above)
            const v = validateTestCase(c, { prefix: state.project.code, full, evidence: state.project.evidence });
            for (const msg of v.errors) {
                if (/ID format|Missing test case ID|start with Verify|document-reference|concrete test data/.test(msg)) continue;
                if (c.steps.length && /Missing (test steps|expected result)/.test(msg)) continue;      // reported per step below
                err(id, (VALIDATOR_FIELD.find(([re]) => re.test(msg)) || [, "Case"])[1], msg + (/evidence/.test(msg) ? " — add it under Workbook details (whole run) or on the case." : "."));
            }
            if (/\bback[- ]office\b/i.test(all)) err(id, "Wording", "Say Manager web or Admin portal, never back office.");

            if (!(c.data || "").trim()) err(id, "Test Data", "Test Data is empty — cite the concrete dummy data this case uses.");
            if (/valid data|valid user|test user|test data\b|appropriate (test )?data|any user|\bN\/A\b/i.test(c.data + " " + c.pre)) err(id, "Test Data", "Use concrete values, not generic placeholders.");
            if (/<add to Test Data>/.test(c.data)) err(id, "Test Data", "A referenced Test Data item does not exist.");

            c.steps.forEach((s, k) => {
                const step = `step ${k + 1}`;
                const a = s.action || "";
                if (!a.trim()) err(id, step, "Test step is empty.");
                else {
                    if (/^\s/.test(a)) err(id, step, "Test step starts with a space.");
                    if (/^\d+[.)]/.test(a.trim())) err(id, step, "Do not number steps inside the cell — one row per step.");
                    const first = a.trim().split(/\s+/)[0];
                    if (!/^[A-Z]/.test(first) || NOT_VERBS.has(first.toLowerCase())) err(id, step, `Test step should start with a capitalised verb ("${first}").`);
                }
                const e = s.expected || "";
                const n = countShould(e);
                if (n !== 1) err(id, step, `Expected Result needs exactly one "should" (found ${n}).`);
                if (/\bshould\s+\w+\s+or\s+\w+/i.test(e)) err(id, step, 'Expected Result has two verbs ("… or …") — split it.');
                if (/^to confirm:/i.test(e)) toConfirm++;
                if (/^to confirm:/i.test(s.actual || "")) err(id, step, 'Drop the "To confirm:" prefix in the Actual Result.');
                if (s.status === "Pass" && !(s.actual || "").trim()) warn(id, step, "Passed step has no Actual Result.");
            });
        });
    }

    // Every enhancement: one double-action, one maximum-length and one interrupted-network case
    if (suite.sections.length) {
        const text = suite.sections.flatMap(s => s.cases.map(c => c.description + " " + c.steps.map(x => x.action).join(" "))).join(" ");
        if (!/double[- ]?tap|double[- ]?click|concurren|at the same time/i.test(text)) warn("Coverage", "EDG", "Add one double-action or concurrency case.");
        if (!/\b(long|maximum length|max length|truncat\w*|34-character)\b/i.test(text)) warn("Coverage", "EDG", "Add one maximum-length or truncation case.");
        if (!/network|offline|connection/i.test(text)) warn("Coverage", "EDG", "Add one offline or interrupted-network case.");
    }

    // Test Data: rows used by no case are removed on export
    for (let d of state.data) {
        if (!d.item) continue;
        if (d.category !== "Environment" && !usedBy(d.item, suite).length) warn(d.item, "Test Data", "Used by no case — left out of the exported Test Data sheet.");
        if (/valid data|test user|^n\/a$/i.test(d.value || "")) err(d.item, "Test Data", "Test Data holds concrete values — never \"valid data\" or \"test user\".");
    }
    const envItems = state.data.filter(d => d.category === "Environment").map(d => d.item);
    const missing = ENVIRONMENT_DATA.map(e => e.item).filter(item => !envItems.includes(item));
    if (missing.length) warn("Test Data", "Environment", `Environment rows come first: ${missing.join(", ")} missing.`);

    return { errors, warnings, toConfirm };
}
