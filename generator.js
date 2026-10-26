// Test case generator — Altametrics Test Case Workbook Standard v3.
// Suite = sections (modules) → cases (ID, Importance, Description, Preconditions, Test Data) → steps (Step, Expected, Actual, Status).
// Module order: functional modules, then RPT (Reports and payroll), REG (Regression impact), EDG (Edge and negative).

const IMPORTANCE = ["High", "Medium", "Low"];
const STATUSES = ["Untested", "Pass", "Fail", "Blocked"];
const NO_DATA = "";
const CATEGORY_ORDER = ["Environment", "Users", "Configuration", "Schedule", "Records", "Reports", "Boundary"];

const COVERAGE = [
    { key: "validation", label: "Field validation & boundaries", hint: "Required, min / max, length, format and time-order checks on the form fields" },
    { key: "buttons",    label: "Button states",                 hint: "Each action's result and what enables it" },
    { key: "reports",    label: "Reports and payroll (RPT)",     hint: "Cases from the Reports and payroll list" },
    { key: "regression", label: "Regression impact (REG)",       hint: "Cases from the Regression list" },
    { key: "edge",       label: "Edge and negative (EDG)",       hint: "Double tap, network loss, long names, overnight shift, empty state" },
];

// Fixed sections that come after the functional modules, in this order (team format: UI, API, DB, INT, RPT, REG, EDG)
const TAIL_SECTIONS = {
    UI: { name: "UI and layout", title: "UI layout, states and navigation" },
    API: { name: "API contract", title: "API contract (placeholders until the contract is supplied)" },
    DB: { name: "Database records", title: "Database records (placeholders until the schema is supplied)" },
    INT: { name: "Integrations", title: "Integrations and downstream systems" },
    RPT: { name: "Reports and payroll", title: "Reports and payroll" },
    REG: { name: "Regression impact", title: "Regression impact" },
    EDG: { name: "Edge and negative", title: "Edge, negative and non-functional" },
};

// Scope: "changed" (changed areas only, CR IDs), "ui" (UI-only revamp, CR IDs), "full" (full module, no CR)
const SCOPES = {
    changed: { label: "Changed areas only", infix: "CR" },
    ui: { label: "UI-only revamp", infix: "CR" },
    full: { label: "Full module", infix: "" },
};

// Tail modules a scope includes; UI-only revamps never get API, DB or INT
function tailPlan(scope) {
    return scope === "ui" ? ["UI", "RPT", "REG", "EDG"] : Object.keys(TAIL_SECTIONS);
}

function splitLines(text) {
    return (text || "").split("\n").map(line => line.trim()).filter(Boolean);
}

function splitParts(line) {
    return line.split("|").map(part => part.trim());
}

function lowerFirst(text) {
    return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

function upperFirst(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function sentence(text) {
    const t = upperFirst((text || "").trim());
    return !t || /[.!?"')]$/.test(t) ? t : t + ".";
}

// Descriptions always read "Verify …."
function verify(text) {
    const t = (text || "").trim().replace(/^verify\s+(that\s+)?/i, "");
    // Lower-case only ordinary words ("The menu …" → "the menu …"); keep names like "Attestation Report", "NOTE step"
    const ordinary = /^(The|A|An|This|That|These|Those|Each|Every|Any|All|Only|Both|Its|Their|Some|No|One|Selecting|Tapping|Clicking|Turning|Opening|Entering|Choosing|Changing|Adding|Removing)\b/.test(t);
    return sentence("Verify " + (ordinary ? lowerFirst(t) : t));
}

// Steps are imperative, unnumbered, no leading space, no trailing period ("Open the clock dashboard")
function sentenceNoDot(text) {
    return upperFirst((text || "").trim().replace(/^\d+[.)]\s*/, "").replace(/\.$/, ""));
}

// ---------- Actual Result: past-tense mirror of the Expected Result ----------

const IRREGULAR = { show: "showed", read: "read", be: "was", run: "ran", open: "opened", close: "closed", stay: "stayed", begin: "began", go: "went", keep: "kept", hold: "held", become: "became", leave: "left", split: "split", set: "set" };

function pastVerb(verb) {
    if (IRREGULAR[verb]) return IRREGULAR[verb];
    if (/e$/.test(verb)) return verb + "d";
    if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + "ied";
    return verb + "ed";
}

function pastTense(expected) {
    let text = (expected || "").replace(/^to confirm:\s*/i, "").trim();
    const m = /^(.*?)\bshould\s+(not\s+|no longer\s+|still\s+)?(\w+)(.*)$/i.exec(text);
    if (!m) return text;
    const [, subject, modifier = "", verb, rest] = m;
    const plural = /\band\b/i.test(subject) || /\b(cards|fields|buttons|punches|items|cases|rows|options|cards|totals|hours|shifts|tips|values|steps|questions|sections|groups|employees|records)\b/i.test(subject);
    const mod = modifier.trim().toLowerCase();
    let phrase;
    if (verb.toLowerCase() === "be") {
        const be = plural ? "were" : "was";
        phrase = mod ? `${be} ${mod}` : be;
    } else if (mod === "not") {
        phrase = `did not ${verb}`;
    } else {
        phrase = (mod ? mod + " " : "") + pastVerb(verb.toLowerCase());
    }
    return `${subject}${phrase}${rest}`.replace(/\s+/g, " ").trim();
}

// ---------- Parsing ----------

// Scenario syntax (per module):
//   Verify the list shows one card per employee. [High] {Pending punches roster}
//   Pre: optional precondition override
//   - Open the list => The employee list should be displayed.
// A single line "action => expected" (no dash) is a one-step case.
function parseScenarios(text) {
    const cases = [];
    let current = null;

    for (let raw of splitLines(text)) {
        if (/^pre(condition)?s?\s*:/i.test(raw) && current) {
            current.pre = raw.replace(/^[^:]+:\s*/, "");
            continue;
        }
        if (/^data\s*:/i.test(raw) && current) {
            current.refs.push(...raw.replace(/^[^:]+:\s*/, "").split(",").map(s => s.trim()).filter(Boolean));
            continue;
        }
        if (/^[-*•]\s*/.test(raw)) {
            const [action, expected] = raw.replace(/^[-*•]\s*/, "").split("=>").map(s => s && s.trim());
            if (!current) {
                current = { description: verify(action), importance: "Medium", refs: [], steps: [] };
                cases.push(current);
            }
            current.steps.push({ action: sentenceNoDot(action), expected: expected ? sentence(expected) : "To confirm: Add the expected result." });
            continue;
        }

        let line = raw;
        let importance = "Medium";
        const imp = /\[(high|medium|low)\]/i.exec(line);
        if (imp) {
            importance = upperFirst(imp[1].toLowerCase());
            line = line.replace(imp[0], "");
        }
        const refs = [];
        line = line.replace(/\{([^}]*)\}/g, (_, inner) => {
            refs.push(...inner.split(",").map(s => s.trim()).filter(Boolean));
            return "";
        }).trim();

        if (line.includes("=>")) {
            const [action, expected] = line.split("=>").map(s => s.trim());
            current = { description: verify(action), importance, refs, steps: [{ action: sentenceNoDot(action), expected: sentence(expected) }] };
        } else {
            current = { description: verify(line), importance, refs, steps: [] };
        }
        cases.push(current);
    }
    return cases;
}

// "Clock In | time | required | after=..." → field
function parseField(line) {
    const [name, type = "text", ...rules] = splitParts(line);
    const field = { name, type: type.toLowerCase(), required: false };
    for (let rule of rules) {
        const [key, ...rest] = rule.split("=");
        const value = rest.join("=").trim();
        const k = key.trim().toLowerCase();
        if (k === "required") field.required = true;
        else if (k === "options") field.options = value.split(",").map(o => o.trim()).filter(Boolean);
        else if (["min", "max", "minlen", "maxlen"].includes(k)) field[k] = Number(value);
        else if (k === "after") field.after = value;
        else if (k === "error") field.error = value;
    }
    return field;
}

// "Confirm | ACK | Selected punches should show Confirmed. | at least one punch is selected"
function parseAction(line) {
    const [name, module = "", expected = "", enabledWhen = ""] = splitParts(line);
    return { name, module: module.toUpperCase(), expected, enabledWhen };
}

// ---------- Generation ----------

function generateSuite(state) {
    const p = state.project;
    const cov = state.coverage;
    const dataItems = state.data.map(d => ({ ...d }));
    const firstModule = state.modules[0] || { name: p.name, code: "GEN", precondition: p.basePre };

    function dataItem(category, item, value, notes = "") {
        let existing = dataItems.find(d => d.item.toLowerCase() === item.toLowerCase());
        if (!existing) {
            existing = { category, item, value, notes };
            dataItems.push(existing);
        }
        return existing.item;
    }

    function dataText(refs) {
        return (refs || []).map(ref => {
            const d = dataItems.find(x => x.item.toLowerCase() === ref.toLowerCase());
            return d ? `${d.item}: ${d.value}` : `${ref}: <add to Test Data>`;
        }).join("\n");
    }

    function makeCase(c, defaultPre) {
        return {
            id: "",
            importance: c.importance || "Medium",
            description: c.description,
            pre: c.pre || defaultPre || p.basePre || "",
            data: dataText(c.refs),
            steps: (c.steps.length ? c.steps : [{ action: "Review the screen", expected: "To confirm: Add the expected result." }])
                // Pass only when the run has execution evidence; otherwise the step waits, Untested
                .map(s => p.defaultStatus === "Pass" && (p.evidence || "").trim()
                    ? { action: s.action, expected: s.expected, actual: pastTense(s.expected), status: "Pass" }
                    : { action: s.action, expected: s.expected, actual: "", status: "Untested" }),
        };
    }

    const sections = [];
    const byCode = {};

    for (let m of state.modules) {
        const code = m.code.toUpperCase();
        if (TAIL_SECTIONS[code] || !code) continue;     // RPT / REG / EDG come from their own lists
        const section = { code, name: m.name, title: m.description || m.name, cases: [] };
        const pre = m.precondition || p.basePre;
        for (let c of parseScenarios(m.scenarios)) section.cases.push(makeCase(c, pre));
        sections.push(section);
        byCode[code] = { section, pre, module: m };
    }

    const target = code => byCode[(code || "").toUpperCase()] || Object.values(byCode)[0];
    const primaryRef = dataItems.find(d => /primary employee/i.test(d.item));
    const baseRefs = primaryRef ? [primaryRef.item] : [];

    // ---------- Field validation ----------
    if (cov.validation && state.form.fields.trim() && sections.length) {
        const t = target(state.form.module);
        const submit = state.form.submit || "Save";
        const add = (importance, description, steps, refs = []) =>
            t.section.cases.push(makeCase({ importance, description, steps, refs: [...baseRefs, ...refs] }, t.pre));

        for (let f of splitLines(state.form.fields).map(parseField)) {
            const error = f.error ? `"${f.error}"` : "A required-field message";

            if (f.required) {
                add("Medium", `Verify ${f.name} is required.`, [
                    { action: `Clear ${f.name}`, expected: `${f.name} should be empty.` },
                    { action: `Tap ${submit}`, expected: `${f.error ? error : "To confirm: " + error} should be displayed for ${f.name}.` },
                    { action: "Review the form", expected: "To confirm: The form should remain open." },
                ]);
            }

            if (f.type === "number") {
                const lo = isNaN(f.min) ? null : f.min;
                const hi = isNaN(f.max) ? null : f.max;
                const values = [lo, hi, lo === null ? null : +(lo - 0.01).toFixed(2), hi === null ? null : +(hi + 0.01).toFixed(2)]
                    .filter(v => v !== null).join("; ");
                const ref = values ? [dataItem("Boundary", `${f.name} boundaries`, `${values} (min; max; below min; above max)`)] : [];
                if (lo !== null) {
                    add("Medium", `Verify ${f.name} accepts the minimum value of ${lo}.`, [
                        { action: `Enter ${lo} in ${f.name}`, expected: `${f.name} should show ${lo}.` },
                        { action: `Tap ${submit}`, expected: "To confirm: The value should be saved." },
                    ], ref);
                    add("Medium", `Verify ${f.name} rejects a value below ${lo}.`, [
                        { action: `Enter ${+(lo - 0.01).toFixed(2)} in ${f.name}`, expected: "To confirm: A validation message should be displayed." },
                    ], ref);
                }
                if (hi !== null) {
                    add("Medium", `Verify ${f.name} accepts the maximum value of ${hi}.`, [
                        { action: `Enter ${hi} in ${f.name}`, expected: `${f.name} should show ${hi}.` },
                        { action: `Tap ${submit}`, expected: "To confirm: The value should be saved." },
                    ], ref);
                    add("Medium", `Verify ${f.name} rejects a value above ${hi}.`, [
                        { action: `Enter ${+(hi + 0.01).toFixed(2)} in ${f.name}`, expected: "To confirm: A maximum-value message should be displayed." },
                    ], ref);
                }
                add("Medium", `Verify ${f.name} does not accept letters.`, [
                    { action: `Attempt to enter abc in ${f.name}`, expected: "The keypad should not accept letters." },
                ]);
            }

            if (f.type === "text" && !isNaN(f.maxlen)) {
                const ref = [dataItem("Boundary", `${f.name} length`, `${f.maxlen} characters (limit); ${f.maxlen + 1} characters (over limit)`)];
                add("Medium", `Verify ${f.name} accepts ${f.maxlen} characters.`, [
                    { action: `Enter ${f.maxlen} characters in ${f.name}`, expected: "The full text should be displayed." },
                    { action: `Tap ${submit}`, expected: "To confirm: The full text should be saved." },
                ], ref);
                add("Medium", `Verify ${f.name} stops at ${f.maxlen} characters.`, [
                    { action: `Enter ${f.maxlen + 1} characters in ${f.name}`, expected: `To confirm: The field should stop accepting input at ${f.maxlen} characters.` },
                ], ref);
            }

            if (f.type === "time" && f.after) {
                add("Medium", `Verify ${f.name} earlier than ${f.after}.`, [
                    { action: `Enter 09:00 AM in ${f.after}`, expected: `${f.after} should show 09:00 AM.` },
                    { action: `Enter 08:00 AM in ${f.name}`, expected: `${f.name} should show 08:00 AM.` },
                    { action: `Tap ${submit}`, expected: "To confirm: The shift should be treated as an overnight shift." },
                ]);
            }

            if (f.type === "date") {
                add("Medium", `Verify ${f.name} rejects an invalid date.`, [
                    { action: `Enter 02/30/2026 in ${f.name}`, expected: "To confirm: An invalid date message should be displayed." },
                ]);
            }

            if (f.type === "select" && f.options) {
                add("Medium", `Verify ${f.name} lists every option.`, [
                    { action: `Open the ${f.name} dropdown`, expected: `The options ${f.options.join(", ")} should be displayed.` },
                    { action: `Select ${f.options[f.options.length - 1]}`, expected: `${f.name} should show ${f.options[f.options.length - 1]}.` },
                ]);
            }

            if (f.type === "email" || f.type === "phone") {
                const bad = f.type === "email" ? "user@@example" : "12ab";
                add("Medium", `Verify ${f.name} rejects an invalid format.`, [
                    { action: `Enter ${bad} in ${f.name}`, expected: `${f.name} should show ${bad}.` },
                    { action: `Tap ${submit}`, expected: `To confirm: An invalid ${f.type} message should be displayed.` },
                ]);
            }
        }
    }

    // ---------- Button states ----------
    const actions = splitLines(state.actions).map(parseAction);
    if (cov.buttons && sections.length) {
        for (let a of actions) {
            const t = target(a.module);
            if (a.expected) {
                t.section.cases.push(makeCase({
                    importance: "High",
                    description: `Verify ${a.name} completes its action.`,
                    refs: baseRefs,
                    steps: [{ action: `Tap ${a.name}`, expected: sentence(a.expected) }],
                }, t.pre));
            }
            if (a.enabledWhen) {
                const cond = a.enabledWhen.replace(/\.$/, "");
                t.section.cases.push(makeCase({
                    importance: "High",
                    description: `Verify ${a.name} is disabled until ${cond}.`,
                    refs: baseRefs,
                    steps: [
                        { action: `Review ${a.name} before ${cond}`, expected: `${a.name} should be disabled.` },
                        { action: `Make sure ${cond}`, expected: `${a.name} should be enabled.` },
                    ],
                }, t.pre));
            }
        }
    }

    // ---------- RPT / REG (authored with the scenario syntax) ----------
    const tail = (code, text) => ({
        code, ...TAIL_SECTIONS[code],
        cases: parseScenarios(text).map(c => makeCase(c, p.basePre)),
    });
    // ---------- UI, API, DB, INT (team format) ----------
    const scope = state.scope || "changed";
    const plan = tailPlan(scope);
    const areas = (state.changeAreas || []).map(a => (a.area || "").trim()).filter(Boolean);
    const areaNames = (areas.length ? areas : sections.map(s => s.title || s.name)).slice(0, scope === "ui" ? 4 : 3);
    const emp = () => dataItem("Users", "Primary employee", "Andrew, PIN 4821, Job Role: Cleaner", "Synthetic: seed before execution.");
    const shift = () => dataItem("Schedule", "Scheduled shift", "Wed 10/21/2026 09:00 AM – 05:30 PM; Rest 11:00 AM, Meal 01:00 PM", "Synthetic.");
    const longName = () => dataItem("Boundary", "Long employee name", "Maximiliano Bartholomew-Fitzgerald (34 characters), PIN 9476", "Seed as an extra employee.");
    const manager = () => dataItem("Users", "Manager web login", "Emma Clarke, Store Manager, emma.clarke@qa.altametrics.test", "Placeholder: confirm the password in the QA vault.");
    const plainPre = p.basePre || firstModule.precondition || "";

    if (plan.includes("UI") && areaNames.length) {
        const ui = { code: "UI", ...TAIL_SECTIONS.UI, cases: [] };
        const add = (importance, description, steps, refs) => ui.cases.push(makeCase({ importance, description, steps, refs }, plainPre));
        for (const a of areaNames) {
            add("High", `Verify ${a} opens from its navigation entry.`,
                [{ action: `Open ${a} from the navigation`, expected: `${a} should be displayed.` }], [emp()]);
            add("High", `Verify ${a} shows a populated card for each entry.`,
                [{ action: `Open ${a} for the primary employee`, expected: "A card should be displayed for each entry." },
                 { action: "Review the first card", expected: "To confirm: The card should show the date, time and status." }], [emp(), shift()]);
            if (scope === "ui") {
                add("Medium", `Verify the selected entry on ${a} shows the active state.`,
                    [{ action: `Tap the first entry on ${a}`, expected: "The entry should be highlighted as active." }], [emp(), shift()]);
                add("Medium", `Verify ${a} lists multiple entries in time order.`,
                    [{ action: `Open ${a} for the primary employee with three entries`, expected: "The three entries should be listed in time order." }],
                    [emp(), dataItem("Schedule", "Multiple entries", "Mon 10/19, Tue 10/20 and Wed 10/21/2026, 09:00 AM – 05:30 PM", "Synthetic.")]);
                add("Medium", `Verify the totals box on ${a} adds up the listed entries.`,
                    [{ action: `Review the totals box on ${a}`, expected: "To confirm: The total should equal the sum of the listed entries." }], [emp(), shift()]);
            }
            add("Medium", `Verify ${a} shows the empty state when there are no entries.`,
                [{ action: `Open ${a} for an employee with no entries`, expected: "To confirm: An empty-state message should be displayed." }],
                [dataItem("Users", "Employee with no entries", "Brett, PIN 5732, Job Role: Server, no shifts this week", "Synthetic.")]);
            add("Low", `Verify ${a} keeps its layout with a 34-character employee name.`,
                [{ action: `Open ${a} for Maximiliano Bartholomew-Fitzgerald`, expected: "The full name should be displayed without overlapping other elements." }], [longName()]);
        }
        if (ui.cases.length) sections.push(ui);
    }
    if (plan.includes("API") && areaNames.length) {
        const api = { code: "API", ...TAIL_SECTIONS.API, cases: [] };
        const apiPre = "The QA API is reachable with a manager token for site Altametrics.";
        for (const a of areaNames) {
            const endpoint = dataItem("Configuration", `${a} API endpoint`, "Contract placeholder — endpoint not supplied", "Placeholder: confirm the API contract.");
            api.cases.push(makeCase({ importance: "High", description: `Verify the ${a} request saves the values sent.`, refs: [endpoint, emp()], steps: [
                { action: `Send the ${a} request with the values of the primary employee`, expected: "To confirm: The response should return status 200 with the saved values." },
                { action: "Read the record back with a GET request", expected: "To confirm: The returned record should match the values sent." }] }, apiPre));
            api.cases.push(makeCase({ importance: "Medium", description: `Verify the ${a} request rejects a missing required field.`, refs: [endpoint, emp()], steps: [
                { action: "Send the request without the employee ID", expected: "To confirm: The response should return a validation error." }] }, apiPre));
        }
        sections.push(api);
    }
    if (plan.includes("DB") && areaNames.length) {
        const db = { code: "DB", ...TAIL_SECTIONS.DB, cases: [] };
        for (const a of areaNames) {
            const table = dataItem("Configuration", `${a} table`, "Contract placeholder — table not supplied", "Placeholder: confirm the schema.");
            db.cases.push(makeCase({ importance: "Medium", description: `Verify the ${a} record is stored for the employee and business day.`, refs: [table, emp(), shift()], steps: [
                { action: `Complete ${a} for the primary employee in the application`, expected: "To confirm: A confirmation should be displayed." },
                { action: `Query the ${a} table for the employee and business day`, expected: "To confirm: One row should hold the saved values." }] }, plainPre));
        }
        sections.push(db);
    }
    if (plan.includes("INT") && areaNames.length) {
        const int = { code: "INT", ...TAIL_SECTIONS.INT, cases: [] };
        const period = () => dataItem("Reports", "Pay period", "Mon 10/19/2026 – Sun 10/25/2026", "Synthetic.");
        for (const a of areaNames.slice(0, 2)) {
            int.cases.push(makeCase({ importance: "Medium", description: `Verify the ${a} change reaches the payroll export.`, refs: [emp(), shift(), period()], steps: [
                { action: `Complete ${a} for the primary employee`, expected: "To confirm: The change should be saved." },
                { action: "Run the payroll export for the pay period in Manager web", expected: `To confirm: The export should include the ${a} values.` }] }, plainPre));
        }
        sections.push(int);
    }

    if (cov.reports && (state.reports || "").trim()) sections.push(tail("RPT", state.reports));
    if (cov.regression && (state.regression || "").trim()) sections.push(tail("REG", state.regression));

    // ---------- Edge and negative ----------
    const edgeWritten = parseScenarios(state.edgeScenarios || "");
    if (!cov.edge && edgeWritten.length) {
        sections.push({ code: "EDG", ...TAIL_SECTIONS.EDG, cases: edgeWritten.map(c => makeCase(c, p.basePre)) });
    }
    if (cov.edge && sections.length) {
        const pre = firstModule.precondition || p.basePre;
        const section = { code: "EDG", ...TAIL_SECTIONS.EDG, cases: edgeWritten.map(c => makeCase(c, p.basePre)) };
        const add = (importance, description, steps, refs = [], casePre = pre) =>
            section.cases.push(makeCase({ importance, description, steps, refs, pre: casePre }));

        for (let a of actions.filter(a => /save|submit|confirm|delete|resolve|report|send|approve|clock|acknowledge|continue/i.test(a.name))) {
            const t = target(a.module);
            add("Medium", `Verify a double tap on ${a.name} records one action.`,
                [{ action: `Double-tap ${a.name}`, expected: "Only one confirmation should be displayed." },
                 { action: "Open Punch Management for the employee", expected: "To confirm: Only one record should be listed." }],
                baseRefs, t ? t.pre : pre);
            add("Medium", `Verify ${a.name} when the network connection is lost.`,
                [{ action: "Disconnect the device from the network", expected: "The device should be offline." },
                 { action: `Tap ${a.name}`, expected: "To confirm: A connection message should be displayed." },
                 { action: "Reconnect the device and retry", expected: "To confirm: The action should complete." }],
                baseRefs, t ? t.pre : pre);
        }

        const longRef = dataItem("Boundary", "Long employee name", "Maximiliano Bartholomew-Fitzgerald (34 characters), PIN 9476", "Seed as an extra employee.");
        add("Medium", "Verify a long employee name fits on the screen.",
            [{ action: "Enter the PIN", expected: `${firstModule.name} should be displayed.` },
             { action: "Review the name", expected: "The full name should be displayed without overlap." }],
            [longRef], "Maximiliano Bartholomew-Fitzgerald is not clocked in.");

        const nightRef = dataItem("Boundary", "Overnight shift", "Adams, 10/20/2026 10:00 PM to 10/21/2026 06:00 AM, job code Cleaner");
        add("Medium", "Verify an overnight shift shows correct times across midnight.",
            [{ action: "Enter Adams' PIN at 01:00 AM on 10/21/2026", expected: "The SHIFT START should show 10:00 PM." },
             { action: "Review the timer", expected: "The timer should show 3 hours elapsed." }],
            [nightRef], "Adams is clocked in at 10:00 PM on 10/20/2026.");

        sections.push(section);
    }

    teamFormatPass(sections, state, { makeCase, dataItem, dataText, emp, shift, longName, manager, plainPre });
    const order = c => Object.keys(TAIL_SECTIONS).indexOf(c);
    const suite = { sections: sections.filter(s => s.cases.length && (!TAIL_SECTIONS[s.code] || plan.includes(s.code)))
        .map((s, i) => ({ s, i })).sort((a, b) => (order(a.s.code) - order(b.s.code)) || a.i - b.i).map(x => x.s) };
    if (scope === "ui") balanceUiOnly(suite);
    numberCases(suite, p);
    return { suite, data: dataItems };
}

// Stable internal IDs: case IDs change when a module is renumbered, uids never do (Smart proposals target uids)
function ensureUids(suite) {
    const seen = new Set();
    for (const s of suite.sections) for (const c of s.cases) {
        if (!c.uid || seen.has(c.uid)) c.uid = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        seen.add(c.uid);
    }
    return suite;
}

function idPrefix(project, code) {
    return [project.code, project.infix, code].map(s => (s || "").trim()).filter(Boolean).join("_");
}

// PREFIX_CR_MOD_NNN — 3 digits, sequential per module, no gaps
function numberCases(suite, project) {
    for (let section of suite.sections) renumberSection(section, project);
}

function renumberSection(section, project) {
    const prefix = idPrefix(project, section.code);
    section.cases.forEach((c, i) => { c.id = prefix + "_" + String(i + 1).padStart(3, "0"); });
}

// Case status: Passed only when every step passes; Failed if any step fails; Blocked if any blocked and none failed
function caseStatus(c) {
    const s = c.steps.map(x => x.status);
    if (s.includes("Fail")) return "Fail";
    if (s.includes("Blocked")) return "Blocked";
    if (s.length && s.every(x => x === "Pass")) return "Pass";
    return "Untested";
}

// Test Data "Used By": every case whose Test Data mentions the item
function usedBy(item, suite) {
    const ids = [];
    if (!item) return ids;
    for (let section of suite.sections) {
        for (let c of section.cases) {
            if (c.data.toLowerCase().includes(item.toLowerCase() + ":")) ids.push(c.id);
        }
    }
    return ids;
}

// Test Data rows for the workbook: category order, rows used by no case removed (Environment rows stay, "All cases")
function exportData(data, suite) {
    const rank = c => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; };
    return data
        .map((d, i) => ({ ...d, ids: usedBy(d.item, suite), order: i }))
        .filter(d => d.item && (d.category === "Environment" || d.ids.length))
        .sort((a, b) => rank(a.category) - rank(b.category) || a.order - b.order)
        .map(d => ({ ...d, usedByText: d.category === "Environment" && !d.ids.length ? "All cases" : d.ids.join(", ") }));
}

// ---------- Team format: coverage rules, document isolation, synthetic data ----------

// References to the document itself: "(Fig : 1.1)", "Figure 2", "see Slide 3", "Image 4", "Screenshot 1.2", "Appendix A1"
const DOC_REF_SOURCE = String.raw`\(?\s*(?:see\s+|refer(?:\s+to)?\s+)?\b(?:fig(?:ure)?s?|slides?|images?|img|screen\s*shots?|exhibits?|annexures?|appendix|appendices|illustrations?|diagrams?)\b\.?\s*(?:no\.?\s*)?[:#.\-–—]?\s*[A-Z]?\d+(?:[.\-]\d+)*[a-z]?\s*\)?`;
const DOC_REF = new RegExp(DOC_REF_SOURCE, "gi");

// Words that mean a case tests the uploaded document instead of the application
const DOCUMENT_TEST = new RegExp(`${DOC_REF_SOURCE}|\\b(?:release notes|the (?:document|deck|presentation|pdf|prd)|thank you slide|previous (?:screen|behaviou?r))\\b`, "i");

// A description whose subject is nothing but punctuation or a reference: "Verify (…) is displayed."
function emptySubject(description) {
    const subject = String(description || "").replace(/^Verify\s+/i, "").replace(/\s+(?:is|are)\s+(?:displayed|shown|visible)\.?$/i, "").replace(DOC_REF, "");
    return !/[A-Za-z]{3,}/.test(subject);
}

// What the sources say about wizards, timers and attempt limits
function detectCoverage(text) {
    const t = String(text || "");
    const out = { wizards: [], timers: [], limits: [] };
    const named = /\b([A-Z][\w-]*(?:[ -][A-Za-z][\w-]*){0,2})\s+wizard\b/.exec(t);
    if (named) out.wizards.push(`${named[1]} wizard`);
    else if (/\bwizard\b|\bstep \d+ of \d+\b/i.test(t)) out.wizards.push("wizard");

    const timer = /\b(one-time code|verification code|OTP|session|code|link|token)\b[^.\n]{0,60}?\b(?:expires?|valid for|times? out|timeout)\b[^.\n]{0,30}?(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?)/i.exec(t);
    const bare = !timer && /\b(?:expires?|valid for|times? out after|timeout of)\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?)/i.exec(t);
    const unitName = u => /^s/i.test(u) ? "second" : /^m/i.test(u) ? "minute" : "hour";
    if (timer) out.timers.push({ name: "the " + timer[1].replace(/^otp$/i, "one-time code").toLowerCase(), amount: +timer[2], unit: unitName(timer[3]) });
    else if (bare) out.timers.push({ name: "the code", amount: +bare[1], unit: unitName(bare[2]) });

    const limit = /\b(?:after|maximum of|max(?:imum)?|up to|limit of|locked after)\s+(\d+)\s+(?:failed\s+|wrong\s+|invalid\s+)?(attempts?|tries|retries)\b/i.exec(t);
    if (limit && +limit[1] > 1) out.limits.push({ count: +limit[1], what: /tr/i.test(limit[2]) ? "tries" : "attempts" });
    return out;
}

function teamFormatPass(sections, state, h) {
    const cov = state.teamCoverage || { wizards: [], timers: [], limits: [] };
    const functional = sections.filter(s => !TAIL_SECTIONS[s.code]);
    const home = functional[0];
    const caseText = c => c.description + " " + c.steps.map(x => x.action + " " + x.expected).join(" ");
    const find = re => sections.some(s => s.cases.some(c => re.test(caseText(c))));
    let edg = sections.find(s => s.code === "EDG");
    const edgSection = () => { if (!edg) { edg = { code: "EDG", ...TAIL_SECTIONS.EDG, cases: [] }; sections.push(edg); } return edg; };
    const area = home ? (home.title || home.name) : (state.project.name || "the feature");
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // SUT isolation: never test the uploaded document
    // Steps whose result has no real subject ("Verify should be displayed.", left over from a removed caption) are dropped
    const hollow = st => { const subj = String(st.expected || "").replace(/^to confirm:\s*/i, "").split(/\bshould\b/i)[0].replace(/\b(?:the|a|an)\b/gi, "").trim(); return !/[A-Za-z]{3,}/.test(subj) || /^(?:verify|it|this|that|they|these|those|review|check)$/i.test(subj); };
    for (const s of sections) {
        for (const c of s.cases) {
            c.steps = c.steps.filter(st => !hollow(st));
            // Keep "shows its N expected elements" true after a step is dropped; one check reads as that check
            const counted = /shows its \d+ expected elements\.$/.exec(c.description);
            if (counted && c.steps.length === 1 && typeof verifyFromExpected === "function") c.description = verifyFromExpected(c.steps[0].expected);
            else if (counted) c.description = c.description.replace(/its \d+ expected/, `its ${c.steps.length} expected`);
        }
        s.cases = s.cases.filter(c => c.steps.length && !DOCUMENT_TEST.test(caseText(c)) && !emptySubject(c.description));
    }

    // Every new setting: ON, OFF, and the default with its fallback
    const settings = new Set();
    for (const s of sections) for (const c of s.cases) { const m = /^Verify turning on (.+?) (?:applies|shows|enables)/i.exec(c.description); if (m) settings.add(m[1]); }
    const cfg = sections.find(s => s.code === "CFG") || home;
    for (const name of settings) {
        if (!cfg) break;
        if (!find(new RegExp(`turning off ${esc(name)}`, "i"))) {
            cfg.cases.push(h.makeCase({ importance: "High", description: `Verify turning off ${name} removes its effect.`, refs: [h.manager()], steps: [
                { action: `Turn off ${name} and tap Save`, expected: "To confirm: A saved message should be displayed." },
                { action: "Open the affected screen", expected: `To confirm: The behaviour enabled by ${name} should no longer be available.` }] }, h.plainPre));
        }
        if (!find(new RegExp(`${esc(name)} uses its default`, "i"))) {
            cfg.cases.push(h.makeCase({ importance: "Medium", description: `Verify ${name} uses its default and falls back when it has no value.`, refs: [h.manager()], steps: [
                { action: `Open ${name} on a site where it was never changed`, expected: `To confirm: ${name} should show its default value.` },
                { action: `Clear the saved value of ${name} and open the affected screen`, expected: "To confirm: The fallback behaviour should apply." }] }, h.plainPre));
        }
    }

    // Every wizard: Back on each step, abandon midway, re-enter after cancelling
    for (const w of cov.wizards) {
        if (!home || find(new RegExp(`abandoning the ${esc(w)}`, "i"))) continue;
        home.cases.push(h.makeCase({ importance: "High", description: `Verify Back on each step of the ${w} returns to the previous step.`, refs: [h.emp(), h.shift()], steps: [
            { action: `Open step 2 of the ${w} and tap Back`, expected: "Step 1 should be displayed with its entries kept." },
            { action: `Open the last step of the ${w} and tap Back`, expected: "To confirm: The previous step should be displayed with its entries kept." }] }, h.plainPre));
        home.cases.push(h.makeCase({ importance: "Medium", description: `Verify abandoning the ${w} midway saves nothing.`, refs: [h.emp(), h.shift()], steps: [
            { action: `Complete step 1 of the ${w} and close it`, expected: `To confirm: The ${w} should close without saving.` },
            { action: "Open the affected record", expected: "To confirm: The record should be unchanged." }] }, h.plainPre));
        home.cases.push(h.makeCase({ importance: "Medium", description: `Verify re-entering the ${w} after cancelling starts from step 1.`, refs: [h.emp(), h.shift()], steps: [
            { action: `Tap Cancel on step 2 of the ${w}`, expected: `To confirm: The ${w} should close.` },
            { action: `Open the ${w} again`, expected: "Step 1 should be displayed with no entries from the cancelled session." }] }, h.plainPre));
    }

    // Every expiring value or timer: just inside, just past, regenerating invalidates the previous value
    for (const t of cov.timers) {
        const what = t.name.replace(/^the /, "");
        const limitText = `${t.amount} ${t.unit}${t.amount === 1 ? "" : "s"}`;
        const ref = h.dataItem("Boundary", `${upperFirst(what)} validity`, `${limitText}; inside: 1 second before the limit; past: 1 second after the limit`, "From the sources.");
        const e = edgSection();
        e.cases.push(h.makeCase({ importance: "High", description: `Verify ${t.name} is accepted just inside its ${limitText} limit.`, refs: [ref, h.emp()], steps: [
            { action: `Request ${t.name}`, expected: `${upperFirst(t.name)} should be issued.` },
            { action: `Use ${t.name} 1 second before the limit`, expected: `To confirm: ${upperFirst(t.name)} should be accepted.` }] }, h.plainPre));
        e.cases.push(h.makeCase({ importance: "High", description: `Verify ${t.name} is rejected just past its ${limitText} limit.`, refs: [ref, h.emp()], steps: [
            { action: `Use ${t.name} 1 second after the limit`, expected: "To confirm: An expiry message should be displayed." }] }, h.plainPre));
        e.cases.push(h.makeCase({ importance: "Medium", description: `Verify requesting a new ${what} invalidates the previous one.`, refs: [ref, h.emp()], steps: [
            { action: `Request ${t.name} twice`, expected: `To confirm: A second ${what} should be issued.` },
            { action: `Use the first ${what}`, expected: "To confirm: The first one should be rejected." }] }, h.plainPre));
    }

    // Every attempt or retry limit: below it and at it
    for (const l of cov.limits) {
        const ref = h.dataItem("Boundary", "Attempt limit", `${l.count} ${l.what}; below: ${l.count - 1}; at: ${l.count}`, "From the sources.");
        const e = edgSection();
        e.cases.push(h.makeCase({ importance: "High", description: `Verify ${l.count - 1} failed ${l.what} stay below the limit.`, refs: [ref, h.emp()], steps: [
            { action: `Enter a wrong value ${l.count - 1} times`, expected: "To confirm: An error message should be displayed each time." },
            { action: "Enter the correct value", expected: "To confirm: The action should complete." }] }, h.plainPre));
        e.cases.push(h.makeCase({ importance: "High", description: `Verify reaching ${l.count} failed ${l.what} applies the limit.`, refs: [ref, h.emp()], steps: [
            { action: `Enter a wrong value ${l.count} times`, expected: "To confirm: A limit message should be displayed." }] }, h.plainPre));
    }

    // Every enhancement: double action, maximum length, interrupted network
    if (sections.some(s => s.cases.length)) {
        if (!find(/double[- ]?tap|double[- ]?click|concurren|at the same time/i)) edgSection().cases.push(h.makeCase({ importance: "Medium", description: `Verify a double tap on the ${area} confirm button records one action.`, refs: [h.emp(), h.shift()], steps: [
            { action: `Double-tap the confirm button on ${area}`, expected: "Only one confirmation should be displayed." },
            { action: "Open the record in Manager web", expected: "To confirm: Only one entry should be listed." }] }, h.plainPre));
        if (!find(/\b(long|maximum length|max length|truncat\w*|34-character)\b/i)) edgSection().cases.push(h.makeCase({ importance: "Low", description: `Verify ${area} keeps its layout with a 34-character employee name.`, refs: [h.longName()], steps: [
            { action: `Open ${area} for Maximiliano Bartholomew-Fitzgerald`, expected: "The full name should be displayed without overlapping other elements." }] }, h.plainPre));
        if (!find(/network|offline|connection/i)) edgSection().cases.push(h.makeCase({ importance: "Medium", description: `Verify ${area} when the network connection is lost.`, refs: [h.emp(), h.shift()], steps: [
            { action: "Disconnect the device from the network", expected: "The device should show it is offline." },
            { action: `Complete ${area}`, expected: "To confirm: A connection message should be displayed." },
            { action: "Reconnect and retry", expected: "To confirm: The action should complete once." }] }, h.plainPre));
    }

    // Wording: Manager web, never back office. Test Data: never blank — cite concrete synthetic data.
    const fix = v => String(v || "").replace(/\bback[- ]office\b/gi, "Manager web");
    for (const s of sections) {
        for (const c of s.cases) {
            c.description = fix(c.description);
            c.pre = fix(c.pre);
            c.steps.forEach(x => { x.action = fix(x.action); x.expected = fix(x.expected); x.actual = fix(x.actual); });
            if ((c.data || "").trim()) continue;
            const text = `${c.description} ${c.pre} ${c.steps.map(x => x.action).join(" ")}`;
            const refs = [/\b(manager|web|dashboard|reports?|settings?|portal|admin)\b/i.test(text) ? h.manager() : h.emp()];
            if (/\b(shift|break|clock|schedule|punch|meal|rest)\b/i.test(text)) refs.push(h.shift());
            c.data = h.dataText(refs);
        }
    }
}

// UI-only revamps: 12 to 18 high-value cases — trim the least important from the largest modules
function balanceUiOnly(suite) {
    const total = () => suite.sections.reduce((n, s) => n + s.cases.length, 0);
    const rank = { Low: 0, Medium: 1, High: 2 };
    while (total() > 18) {
        const s = suite.sections.filter(x => x.cases.length > 1).sort((a, b) => b.cases.length - a.cases.length)[0];
        if (!s) break;
        let idx = s.cases.length - 1;
        for (let i = s.cases.length - 1; i >= 0; i--) if (rank[s.cases[i].importance] < rank[s.cases[idx].importance]) idx = i;
        s.cases.splice(idx, 1);
    }
    suite.sections = suite.sections.filter(s => s.cases.length);
}

// Dashboard notes: the scope and every area left out (never dropped silently)
function workbookMeta(state) {
    const scope = state.scope || "changed";
    const present = state.suite.sections.map(s => s.code);
    const excluded = [];
    if (scope === "ui") excluded.push("API, DB and INT — not generated for a UI-only revamp");
    for (const code of tailPlan(scope)) if (!present.includes(code)) excluded.push(`${code} ${TAIL_SECTIONS[code].name} — nothing in the sources for this layer`);
    const intake = state.intake || {};
    if (intake.designNone) excluded.push("Visual design comparison — no design material supplied; visual details are marked \"To confirm:\"");
    return { scopeLabel: (SCOPES[scope] || SCOPES.changed).label, excluded };
}
