// ---------- Smart response validator ----------
// Every proposal from the Smart service is checked here before the tester sees it: the response contract
// (structure and types), the scope it was given, and the same mandatory QA rules the rule-based engine follows
// (validateTestCase, one "should" per step, document isolation, concrete test data, no status or actual results).

const SMART_OPS = ["add", "update", "delete", "suggest"];
const GENERIC_DATA = /^(?:valid (?:data|user)|test (?:data|user)|any user|n\/a|tbd|sample|dummy)$/i;

function isStr(v) { return typeof v === "string"; }
function isStrList(v) { return Array.isArray(v) && v.every(isStr); }

// Structure of one proposal (mirrors the server's response schema)
function proposalShapeErrors(p) {
    const errors = [];
    if (!p || typeof p !== "object") return ["not an object"];
    if (!SMART_OPS.includes(p.op)) errors.push(`unsupported operation "${p.op}"`);
    for (const k of ["target_uid", "module", "module_title", "explanation"]) if (!isStr(p[k])) errors.push(`${k} must be text`);
    if (!isStrList(p.sources)) errors.push("sources must be a list of text");
    if (!isStrList(p.assumptions)) errors.push("assumptions must be a list of text");
    const f = p.fields;
    if (!f || typeof f !== "object") errors.push("fields missing");
    else {
        for (const k of ["description", "importance", "pre", "data"]) if (!isStr(f[k])) errors.push(`fields.${k} must be text`);
        if (!Array.isArray(f.steps) || !f.steps.every(s => s && isStr(s.action) && isStr(s.expected))) errors.push("fields.steps must be a list of { action, expected }");
        // Execution is recorded by testers, never proposed
        if ("status" in f || "actual" in f || "id" in f || (Array.isArray(f.steps) && f.steps.some(s => s && ("status" in s || "actual" in s)))) errors.push("tries to set an ID, status or actual result");
    }
    if (!Array.isArray(p.test_data) || !p.test_data.every(d => d && ["category", "item", "value", "notes"].every(k => isStr(d[k])))) errors.push("test_data must be a list of { category, item, value, notes }");
    return errors;
}

// The case a proposal would produce, checked like any generated case
function proposedCaseErrors(after, p, dataItems) {
    const reasons = [];
    const v = validateTestCase({ ...after, steps: after.steps.map(s => ({ ...s, status: "Untested" })) }, { prefix: "", full: false });
    for (const msg of v.errors) if (!/ID/.test(msg)) reasons.push(msg);
    if (!IMPORTANCE.includes(after.importance)) reasons.push("importance must be High, Medium or Low");
    if (emptySubject(after.description)) reasons.push("description has no real subject");
    after.steps.forEach((s, k) => {
        const n = countShould(s.expected);
        if (n !== 1) reasons.push(`step ${k + 1}: expected result needs exactly one "should" (found ${n})`);
        if (/^\d+[.)]/.test(s.action.trim())) reasons.push(`step ${k + 1}: steps are not numbered inside the cell`);
        const first = (s.action.trim().split(/\s+/)[0] || "");
        if (!/^[A-Z]/.test(first) || NOT_VERBS.has(first.toLowerCase())) reasons.push(`step ${k + 1}: should start with a capitalised verb`);
    });
    // Every "Item: value" line must be a Test Data row (existing, or added by this proposal)
    const known = new Set([...dataItems.map(d => d.item.toLowerCase()), ...p.test_data.map(d => d.item.toLowerCase())]);
    for (const line of after.data.split("\n").map(l => l.trim()).filter(Boolean)) {
        const item = line.split(":")[0].trim().toLowerCase();
        if (!line.includes(":") || !known.has(item)) reasons.push(`test data "${line.slice(0, 40)}" is not a Test Data row — add it to test_data`);
    }
    if (/\bback[- ]office\b/i.test([after.description, after.pre, ...after.steps.flatMap(s => [s.action, s.expected])].join(" "))) reasons.push('says "back office" — use Manager web');
    return reasons;
}

// → { accepted: [{ p, before, after, section }], rejected: [{ p, reasons }], suggestions: [p], summary, openQuestions } or { error }
function validateProposals(data, { scopeUids = null, scope = App.state.scope } = {}) {
    if (!data || typeof data !== "object" || !Array.isArray(data.proposals) || !isStr(data.summary || "")) {
        return { error: "The Smart answer was not in the expected format. Nothing was changed." };
    }
    ensureUids(App.state.suite);
    const cases = allCases(App.state.suite);
    const byUid = new Map(cases.map(x => [x.c.uid, x]));
    const accepted = [], rejected = [], suggestions = [];
    const seenTargets = new Set();

    data.proposals.slice(0, 120).forEach((p, index) => {
        const reasons = proposalShapeErrors(p);
        if (reasons.length) { rejected.push({ p, reasons, index }); return; }
        if (p.op === "suggest") { suggestions.push(p); return; }

        const target = p.target_uid ? byUid.get(p.target_uid) : null;
        if (p.op !== "add") {
            if (!target) { rejected.push({ p, reasons: [`unknown case "${p.target_uid}"`], index }); return; }
            if (scopeUids && !scopeUids.has(p.target_uid)) { rejected.push({ p, reasons: [`${target.c.id} is outside the scope you chose`], index }); return; }
            if (seenTargets.has(p.target_uid)) { rejected.push({ p, reasons: [`${target.c.id} has more than one proposal — only the first is kept`], index }); return; }
            seenTargets.add(p.target_uid);
        }

        // Test data rows the proposal adds
        for (const d of p.test_data) {
            if (!CATEGORY_ORDER.includes(d.category) || d.category === "Environment") reasons.push(`test data "${d.item}" needs a category from Users, Configuration, Schedule, Records, Reports or Boundary`);
            if (!d.item.trim() || !d.value.trim()) reasons.push("a test data row is missing its item or value");
            if (GENERIC_DATA.test(d.value.trim())) reasons.push(`test data "${d.item}" is generic — use concrete values`);
        }

        if (p.op === "delete") {
            if (reasons.length) { rejected.push({ p, reasons, index }); return; }
            accepted.push({ p, before: structuredClone(target.c), after: null, section: target.section.code, index });
            return;
        }

        let after, section;
        if (p.op === "add") {
            section = (p.module || "").toUpperCase();
            const known = MODULE_NAMES[section] || App.state.suite.sections.some(s => s.code === section);
            if (!/^[A-Z][A-Z0-9]{1,5}$/.test(section) || !known) reasons.push(`module "${p.module}" is not a known module code`);
            if (scope === "ui" && ["API", "DB", "INT"].includes(section)) reasons.push("UI-only revamp: no API, DB or INT cases");
            if (scopeUids && scopeUids.size && SmartCommands.target === "module" && section !== SmartCommands.module) reasons.push(`adds to ${section}, outside the module you chose (${SmartCommands.module})`);
            after = {
                uid: "", id: "(new)", importance: p.fields.importance || "Medium", description: p.fields.description.trim(),
                pre: p.fields.pre.trim(), data: p.fields.data.trim(), evidence: "",
                steps: p.fields.steps.map(s => ({ action: s.action.trim(), expected: s.expected.trim(), actual: "", status: "Untested" })),
            };
        } else {
            section = target.section.code;
            const c = target.c;
            const stepsChanged = p.fields.steps.length > 0;
            after = {
                ...structuredClone(c),
                importance: p.fields.importance || c.importance,
                description: p.fields.description.trim() || c.description,
                pre: p.fields.pre.trim() || c.pre,
                data: p.fields.data.trim() || c.data,
                // New or changed steps are not executed yet
                steps: stepsChanged ? p.fields.steps.map(s => ({ action: s.action.trim(), expected: s.expected.trim(), actual: "", status: "Untested" })) : structuredClone(c.steps),
            };
            if (!p.fields.description && !p.fields.importance && !p.fields.pre && !p.fields.data && !stepsChanged && !p.test_data.length) reasons.push("changes nothing");
        }
        reasons.push(...proposedCaseErrors(after, p, App.state.data));
        if (reasons.length) { rejected.push({ p, reasons: [...new Set(reasons)], index }); return; }
        accepted.push({ p, before: target ? structuredClone(target.c) : null, after, section, index });
    });

    return {
        accepted, rejected, suggestions,
        summary: data.summary || "",
        openQuestions: isStrList(data.open_questions) ? data.open_questions : [],
    };
}
