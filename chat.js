// Assistant panel: update the suite by chatting.
// - Commands mode: built-in, rule-based instructions that work offline (see HELP_TEXT).
// - Smart mode: requests go to the server-side Smart service and come back as proposals the tester approves.
// Every change takes an undo snapshot first. App (script.js) provides state, render, save, undo, snapshot.

const HELP_TEXT = `Here is what Commands mode understands (IDs can be short, like SFT_003 or SFT 3):
• mark SFT_003 as pass · mark all CIN as pass · mark step 2 of SFT_003 as fail  (Pass fills the Actual Result)
• set importance of EDG cases to low · make CIN_001, CIN_002 high
• set precondition of SFT_003 to …  ·  set expected of SFT_003 step 2 to …  ·  set actual of SFT_003 step 1 to …
• set evidence to QA build 4.2.1, run by Emma Clarke, 23/10/2026  ·  set evidence of SFT_003 to <link>  (Pass needs evidence)
• add case to CIN: Verify … [High] {Data item}  then lines "- Step => … should …"
• add step to SFT_003: Tap Continue => The clock-out confirmation pop-up should be displayed.
• delete SFT_004 · delete step 2 of SFT_003 · delete section RPT   (the module is renumbered)
• move SFT_004 to EDG · duplicate CIN_002 · rename section CIN to …
• replace Select with Tap (optionally: in CIN) · use Manager web instead of back office · change Brett to Oliver
• use British names  ·  use British names instead of Indian names like Priya Shah  (cases and Test Data; Generate keeps them)
• check · fill actual · renumber · reset statuses · summary · find <text> · undo
Switch to Smart mode for anything else, e.g. "add EN / ES cases for the clock-out note" or "write the ATT module from the test basis".`;

// A few reviewed cases from the reference suite, so the AI copies the house style
function referenceExamples() {
    const pick = [["CIN", 3], ["CIN", 6], ["SFT", 4], ["SFT", 7], ["SFT", 11], ["BRK", 5], ["RPT", 0], ["EDG", 1]];
    return pick.map(([code, i]) => {
        const c = CIO_REFERENCE.suite.sections.find(s => s.code === code).cases[i];
        return { module: code, ...c };
    });
}

// Stable instructions (cached): the role, the v3 standard, the product context, the team rules and style examples
const systemStable = () => `You are the QA assistant inside the Altametrics Test Case Generator. You write and update test case suites for Altametrics products (Zip Clock, Plum Clock, Time Clock, Dashboard, Reports) that follow the Altametrics Test Case Workbook Standard and the QA team's format exactly. The app turns your operations into the Dashboard / Sheet1 / Test Data workbook — you never write spreadsheet cells yourself.

${STANDARD_V3}

TEAM FORMAT — the QA team's decisions. Where it disagrees with the standard above, the team format wins.
${Rules.format || TEAM_FORMAT}

PRODUCT CONTEXT
${ALTAMETRICS_CONTEXT}

REFERENCE STYLE — reviewed cases from ${Rules.source()} (copy this level of detail and wording):
${JSON.stringify(Rules.examples())}
${teamRulesText() ? "\n" + teamRulesText() + "\n" : ""}

HOW TO ANSWER
- Only change what the instruction asks for. Leave every other case untouched.
- Base every label, message and rule on the test basis. When the basis does not state a behaviour, start the expected result with "To confirm: ". Never invent labels or rules.
- If something the standard needs is missing (change areas, surfaces, scope, which flag controls a behaviour), ask one short question in reply and return no operations.
- Operations: upsert_case (send the complete case; case_id is the existing id to replace, or "" for a new case; section_code is the module it belongs to), delete_case (case_id), upsert_section (section object; creates the module when the code is new, otherwise updates name and title), delete_section (section_code), upsert_data and delete_data (data_item; the item name is the key). Fill fields an operation does not use with empty strings and empty arrays.
- Case data: "<Data Item>: <Value>" lines whose items exist in the test data (or that you add with upsert_data, using the categories Environment, Users, Configuration, Schedule, Records, Reports, Boundary).
- Steps: status "Pass" with actual as the exact past-tense mirror of expected without "To confirm:", unless the project says the execution cycle is fresh (then status "Untested" and actual "").
- Test data: never blank; every case cites concrete synthetic data (names, PINs, job roles, dates, times, breaks, punches) that you add with upsert_data.
- Uploaded sources (screenshots, release notes, PDFs, documents) are part of the test basis. Read labels, button text, messages, column names and sample values exactly as they appear on the screens; cite them in quotes in expected results. Use the people, job codes and times visible in them as concrete test data.
- reply: plain sentences for the tester; no markdown tables.`;

// Per-project instructions: setup from the Setup tab plus the test basis
function systemProject() {
    const s = App.state;
    const modules = [...s.modules.filter(m => m.code.trim() && !TAIL_SECTIONS[m.code.toUpperCase()])
        .map(m => `${m.code.toUpperCase()} — ${m.description || m.name} (dashboard: "${m.name} (${m.code.toUpperCase()})")`),
        ...tailPlan(s.scope).map(code => `${code} — ${TAIL_SECTIONS[code].title} (dashboard: "${TAIL_SECTIONS[code].name} (${code})")`)];
    return `THIS PROJECT
- Prefix: ${s.project.code || "(not set)"} · IDs ${idPrefix(s.project, "MOD")}_NNN
- Project name: ${s.project.name || "(not set)"} · File name: ${s.project.fileName || "(not set)"}
- Scope: ${(SCOPES[s.scope] || SCOPES.changed).label}${s.scope === "ui" ? " — 12 to 18 high-value cases, no API, DB or INT" : " — cover configure, capture, action and record"}
- Platform: ${s.project.platform || "(not set)"} · Environment: ${s.project.environment || "(not set)"}
- Design material: ${s.intake && s.intake.designLink ? s.intake.designLink : s.intake && s.intake.designNone ? "none supplied — mark visual details \"To confirm:\"" : "the uploaded screens"}
- Change areas: ${s.changeAreas.filter(a => a.area.trim()).map((a, i) => `${i + 1}. ${a.area} — ${a.type}`).join("; ") || "(not set)"}
- Surfaces: ${s.surfaces.join(", ") || "(not set)"}
- Execution cycle: ${s.project.defaultStatus === "Pass" && (s.project.evidence || "").trim() ? `executed — evidence: ${s.project.evidence}; status "Pass" with past-tense actual results` : 'not executed — no execution evidence, so status "Untested" and actual results empty (never "Pass" without evidence)'}
- Default precondition: ${s.project.basePre || "(none)"}
- Modules, in order: ${modules.join(" | ")}

TEST BASIS
${[(s.basisText || "").trim(), (s.smartNotes || "").trim()].filter(Boolean).join("\n\n") || (Sources.list.length ? "(The uploaded sources in the user message are the test basis.)" : "(No test basis provided. Ask the user for it before writing new cases.)")}
${Sources.list.length ? `\nUPLOADED SOURCES: ${Sources.list.map(x => x.name).join(", ")}` : ""}`;
}

// ---------- Suite helpers ----------

function allCases(suite) {
    return suite.sections.flatMap(section => section.cases.map(c => ({ section, c })));
}

function findSection(suite, code) {
    return suite.sections.find(s => s.code.toUpperCase() === String(code || "").toUpperCase());
}

// "ACK_003", "ack 3", "PPA_CR_ACK_003" → matching cases
function findCaseRefs(suite, text) {
    const found = [];
    const add = hit => { if (hit && !found.some(f => f.c === hit.c)) found.push(hit); };
    const list = allCases(suite);

    for (let token of text.match(/[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*_\d{1,4}\b/g) || []) {
        const t = token.toUpperCase();
        add(list.find(x => x.c.id.toUpperCase() === t) || list.find(x => x.c.id.toUpperCase().endsWith("_" + t) || x.c.id.toUpperCase().endsWith(t)));
    }
    for (let m of text.matchAll(/\b([A-Za-z]{2,6})[\s-]0*(\d{1,4})\b/g)) {
        const section = findSection(suite, m[1]);
        if (!section) continue;
        add(list.find(x => x.section === section && Number(x.c.id.split("_").pop()) === Number(m[2])));
    }
    return found;
}

// Targets: IDs, "all", "all ACK", "ACK cases", "section ACK", "failed cases"
function resolveTargets(suite, text) {
    const refs = findCaseRefs(suite, text);
    if (refs.length) return refs;
    let list = allCases(suite);
    const words = text.split(/[\s,]+/);
    const sections = words.map(w => findSection(suite, w.replace(/[^A-Za-z0-9]/g, ""))).filter(Boolean);
    if (sections.length) list = list.filter(x => sections.includes(x.section));
    const statusWord = /\b(passed|failed|blocked|untested)\b/i.exec(text);
    if (statusWord) {
        const want = { passed: "Pass", failed: "Fail", blocked: "Blocked", untested: "Untested" }[statusWord[1].toLowerCase()];
        list = list.filter(x => caseStatus(x.c) === want);
    }
    if (sections.length || statusWord || /\ball\b|\bevery\b/i.test(text)) return list;
    return [];
}

function nextId(section) {
    const p = App.state.project;
    const prefix = [p.code, p.infix, section.code].map(s => (s || "").trim()).filter(Boolean).join("_");
    const max = allCases(App.state.suite)
        .filter(x => x.c.id.toUpperCase().startsWith(prefix.toUpperCase() + "_"))
        .reduce((m, x) => Math.max(m, Number(x.c.id.split("_").pop()) || 0), 0);
    return prefix + "_" + String(max + 1).padStart(3, "0");
}

function ids(list) {
    const names = list.map(x => (x.c || x).id);
    return names.length > 8 ? names.slice(0, 8).join(", ") + ` and ${names.length - 8} more` : names.join(", ");
}

const STATUS_WORDS = { pass: "Pass", passed: "Pass", fail: "Fail", failed: "Fail", blocked: "Blocked", block: "Blocked", untested: "Untested", "not run": "Untested", pending: "Untested" };

const FIELD_WORDS = {
    evidence: "evidence", "execution evidence": "evidence",
    precondition: "pre", preconditions: "pre", pre: "pre", description: "description", title: "description", summary: "description",
    "test data": "data", data: "data", importance: "importance", priority: "importance",
    expected: "expected", "expected result": "expected", actual: "actual", "actual result": "actual", step: "action", action: "action", "test step": "action",
};

// ---------- Plain-language helpers for Commands mode (offline) ----------

// "Please use British names … update it." → "use British names …"
function normalizeCommand(input) {
    return input.trim()
        .replace(/^(?:please|pls|kindly|can you|could you|would you|i want you to|i want to|let's|lets)\s+/i, "")
        .replace(/^(?:please\s+)/i, "")
        .replace(/[\s.,!]*(?:please|thanks|thank you|update it|do it|for me|now)?[\s.!]*$/i, "")
        .trim();
}

const BRITISH_FIRST = ["Oliver", "Emma", "George", "Sophie", "Harry", "Charlotte", "Thomas", "Lucy", "James", "Grace", "William", "Hannah", "Jack", "Amelia", "Daniel", "Isla", "Samuel", "Olivia", "Henry", "Emily"];
const BRITISH_LAST = ["Clarke", "Bennett", "Hughes", "Turner", "Walker", "Wright", "Cooper", "Hall", "Parker", "Mitchell", "Fletcher", "Harris", "Baker", "Wood", "Taylor", "Evans", "Collins", "Morgan", "Price", "Ward"];
const BRITISH_KNOWN = new Set([...BRITISH_FIRST, ...BRITISH_LAST, "Andrew", "Brett", "Adams", "Peter", "John", "David", "Sarah", "Michael", "Paul", "Mark", "Laura", "Kate", "Ben", "Tom", "Smith", "Jones", "Brown", "Wilson", "Robinson"]);
const INDIAN_NAMES = new Set(["priya", "shah", "harshey", "rahul", "amit", "anjali", "patel", "sharma", "kumar", "singh", "gupta", "reddy", "iyer", "nair", "rao", "mehta", "joshi", "desai", "arjun", "rohan", "vikram", "sanjay", "deepak", "neha", "pooja", "kavya", "aarav", "vivaan", "ishaan", "raj", "ravi", "suresh", "ramesh", "anil", "sunil", "krishna", "lakshmi", "divya", "sneha", "aditya", "karan", "nikhil", "varun", "manish", "ankit", "shreya", "riya", "meera", "verma", "chopra", "malhotra", "agarwal", "jain", "bhat", "pillai", "menon", "chatterjee", "banerjee", "mukherjee", "das", "ghosh", "bose", "binit", "ojha", "harsh", "akash", "anita", "sunita", "geeta", "kiran", "vijay", "ajay", "manoj", "pankaj", "rakesh"]);

// People in the suite: the first part of each Users row ("Priya Shah, Store Manager, …" → "Priya Shah") and names in item labels ("… (Harshey L)")
function peopleNames() {
    const names = new Set();
    const NAME = /^[A-Z][a-z]+(?:\s+(?:[A-Z][a-zA-Z'-]+|[A-Z]))?$/;
    for (const d of App.state.data) {
        if (d.category === "Boundary") continue;               // long-name boundary values stay as they are
        const first = String(d.value || "").split(/[,;(]/)[0].trim();
        if (d.category === "Users" && NAME.test(first)) names.add(first);
        const inItem = /\(([A-Z][a-z]+(?:\s+[A-Z][a-zA-Z'-]*)?)\)/.exec(d.item || "");
        if (inItem) names.add(inItem[1]);
    }
    return [...names];
}

// Names written in case text that are not in Test Data ("Priya Shah opens Manager web")
function namesInText(test) {
    const text = JSON.stringify(App.state.suite) + " " + App.state.data.map(d => `${d.item} ${d.value}`).join(" ");
    const found = new Set();
    for (const m of text.matchAll(/\b([A-Z][a-z]+)(?:\s+([A-Z][a-z]+|[A-Z]\b))?/g)) {
        const full = m[2] && (test(m[2]) || m[2].length === 1) ? `${m[1]} ${m[2]}` : m[1];
        if (test(m[1])) found.add(full);
    }
    return [...found];
}

function isIndianName(name) {
    return name.toLowerCase().split(/\s+/).some(part => INDIAN_NAMES.has(part.replace(/[^a-z]/g, "")));
}

// Find "priya shah" from the instruction in the suite text, with its real capitalisation
function namesMentioned(instruction) {
    // The last pointer wins: "instead of indian name like priya shah" → "priya shah"
    const m = /.*\b(?:like|such as|e\.g\.?|including|for example|instead of|replace|named)\s+(.+)$/i.exec(instruction);
    if (!m) return [];
    const haystack = JSON.stringify(App.state.suite) + JSON.stringify(App.state.data);
    return m[1].split(/\s*(?:,|\band\b|\bor\b|\/)\s*/i)
        .map(s => s.replace(/\b(?:indian|british|english|names?|people|instead|of|with|the|a|an|like|such|as)\b/gi, "").trim())
        .filter(s => s.length > 1)
        .map(s => { const r = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(haystack); return r ? r[0] : null; })
        .filter(Boolean);
}

// A British name with the same shape: "Priya Shah" → "Emma Clarke", "Harshey L" → "Oliver B", "Ravi" → "George"
function britishFor(name, used) {
    const parts = name.split(/\s+/);
    for (let i = 0; i < BRITISH_FIRST.length; i++) {
        const first = BRITISH_FIRST[(i + used.size) % BRITISH_FIRST.length];
        const last = BRITISH_LAST[(i + used.size) % BRITISH_LAST.length];
        const candidate = parts.length === 1 ? first : parts[1].length === 1 ? `${first} ${last[0]}` : `${first} ${last}`;
        if (!used.has(candidate) && !JSON.stringify(App.state.data).includes(candidate)) { used.add(candidate); return candidate; }
    }
    return name;
}

// Replace a word or name everywhere: cases, section titles, Test Data rows, preconditions; e-mail style "priya.shah" too
function replaceEverywhere(from, to) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const variants = [[from, to]];
    if (/\s/.test(from.trim()) && /\s/.test(to.trim())) {
        const dotted = s => s.trim().toLowerCase().replace(/\s+/g, ".");
        variants.push([dotted(from), dotted(to)]);
    }
    let count = 0;
    const swap = value => {
        let out = String(value || "");
        for (const [a, b] of variants) {
            out = out.replace(new RegExp(`${/^\w/.test(a) ? "\\b" : ""}${esc(a)}${/\w$/.test(a) ? "\\b" : ""}`, "gi"), hit => {
                count++;
                return /^[A-Z]/.test(hit) && /^[a-z]/.test(b) ? b.charAt(0).toUpperCase() + b.slice(1) : b;
            });
        }
        return out;
    };
    const s = App.state;
    for (const section of s.suite.sections) {
        section.title = swap(section.title);
        section.name = swap(section.name);
        for (const c of section.cases) {
            for (const f of ["description", "pre", "data"]) c[f] = swap(c[f]);
            c.steps.forEach(st => { st.action = swap(st.action); st.expected = swap(st.expected); st.actual = swap(st.actual); });
        }
    }
    for (const d of s.data) { d.item = swap(d.item); d.value = swap(d.value); d.notes = swap(d.notes); }
    s.project.basePre = swap(s.project.basePre);
    s.modules.forEach(m => { m.scenarios = swap(m.scenarios); m.precondition = swap(m.precondition); });
    return count;
}

// Remembered so the next Generate (which reads the names in the files again) keeps the replacements
function rememberReplacement(from, to) {
    const map = App.state.nameMap = App.state.nameMap || {};
    for (const k of Object.keys(map)) if (map[k] === from) map[k] = to;   // chains: A→B then B→C gives A→C
    if (from !== to) map[from] = to;
}

function applyNameMap() {
    const map = App.state.nameMap || {};
    let n = 0;
    for (const [from, to] of Object.entries(map)) n += replaceEverywhere(from, to);
    return n;
}

// "use British names instead of Indian names like Priya Shah"
function changeNamesCommand(text) {
    const onlyIndian = /\bindian\b/i.test(text);
    const mentioned = namesMentioned(text);
    const people = peopleNames();
    const indianInText = namesInText(isIndianName);
    const targets = [...new Set([
        ...mentioned,
        ...indianInText,
        ...people.filter(n => onlyIndian ? isIndianName(n) : !n.split(/\s+/).every(p => p.length === 1 || BRITISH_KNOWN.has(p))),
    ])];
    if (!targets.length) return { reply: people.length ? `The names in this suite already look British: ${people.join(", ")}.` : "I couldn't find any people in the Test Data. Name one, e.g. \"replace Priya Shah with Emma Clarke\"." };
    App.snapshot("Use British names");
    // Full names first; a single word that is part of a full name is handled with that name
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ordered = targets.sort((a, b) => b.length - a.length)
        .filter((n, i, all) => !all.slice(0, i).some(longer => new RegExp(`\\b${esc(n)}\\b`, "i").test(longer)));
    const used = new Set();
    const pairs = ordered.map(n => [n, britishFor(n, used)]);
    let count = 0;
    for (const [from, to] of pairs) {
        count += replaceEverywhere(from, to);
        rememberReplacement(from, to);
        // Left-over first or last name on its own ("Rahul taps …", "Ms Sharma") follows the full name
        const a = from.split(/\s+/), b = to.split(/\s+/);
        if (a.length === 2 && b.length === 2) {
            [[a[0], b[0]], [a[1], b[1]]].forEach(([x, y]) => {
                if (x.length > 1 && y.length > 1 && (isIndianName(x) || mentioned.includes(from))) { count += replaceEverywhere(x, y); rememberReplacement(x, y); }
            });
        }
    }
    if (!count) { App.undo(); return { reply: `I couldn't find ${targets.join(", ")} in the cases or Test Data.` }; }
    return { reply: `Changed ${pairs.length} name${pairs.length === 1 ? "" : "s"} to British names — ${pairs.map(([a, b]) => `${a} → ${b}`).join(", ")} (${count} place${count === 1 ? "" : "s"}, including Test Data). Generating again keeps them.`, changed: true };
}

// Closest examples when a command is not recognised
function suggestCommands(text) {
    const t = text.toLowerCase();
    const ideas = [];
    if (/name|person|people|employee|manager|user/.test(t)) ideas.push("use British names", "replace Priya Shah with Emma Clarke");
    if (/pass|fail|block|status|done|complete/.test(t)) ideas.push("mark CIN_001 as pass", "mark all EDG as pass");
    if (/import|priority|high|low|medium/.test(t)) ideas.push("set importance of EDG cases to low");
    if (/delete|remove/.test(t)) ideas.push("delete SFT_004", "delete step 2 of SFT_003");
    if (/word|text|replace|change|rename|instead/.test(t)) ideas.push("replace Select with Tap", "use Manager web instead of back office");
    if (/step/.test(t)) ideas.push("add step to CIN_002: Tap Continue => The confirmation should be displayed.");
    return ideas.length ? ideas : ["help", "summary", "check", "use British names"];
}


// ---------- Commands mode ----------

function runCommand(input) {
    const suite = App.state.suite;
    // Plain language: polite words and "update it" are dropped (multi-line case text is kept as typed)
    const text = /\n/.test(input.trim()) ? input.trim() : normalizeCommand(input);
    let m;

    if (/^(help|\?|commands|what can you do)/i.test(text)) return { reply: HELP_TEXT };
    if (/^undo\b/i.test(text)) return { reply: App.undo() ? "Undone." : "Nothing to undo." };

    if (!suite.sections.length && !/^add (a )?(test )?case/i.test(text)) {
        return { reply: "There are no test cases yet. Generate them from Setup, import a workbook, or switch to Smart mode and describe the feature." };
    }

    if (/^(check|validate|review)\b/i.test(text)) {
        const { errors, warnings, toConfirm } = checkSuite(App.state);
        const top = errors.slice(0, 6).map(e => `• ${e.id} (${e.field}): ${e.msg}`).join("\n");
        return {
            reply: errors.length
                ? `Standard v3 check: FAIL — ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${toConfirm} "To confirm:" results.\n${top}${errors.length > 6 ? "\n…open Check in the Test Cases toolbar for the full list." : ""}`
                : `Standard v3 check: PASS — ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${toConfirm} "To confirm:" results.`,
        };
    }

    if (/^fill\s+(the\s+)?actuals?\b/i.test(text)) {
        App.snapshot("Fill actual results");
        let n = 0;
        allCases(suite).forEach(x => x.c.steps.forEach(s => {
            if (s.status === "Pass" && !s.actual.trim()) { s.actual = pastTense(s.expected); n++; }
        }));
        if (!n) { App.undo(); return { reply: "Every passed step already has an Actual Result." }; }
        return { reply: `Filled ${n} Actual Result${n === 1 ? "" : "s"} with the past-tense mirror of the Expected Result.`, changed: true };
    }

    if (/^(summary|status|stats|progress)\b/i.test(text)) {
        const list = allCases(suite);
        const count = s => list.filter(x => caseStatus(x.c) === s).length;
        return { reply: `${list.length} cases in ${suite.sections.length} sections — ${count("Pass")} passed, ${count("Fail")} failed, ${count("Blocked")} blocked, ${count("Untested")} untested.` };
    }

    if (/^renumber\b/i.test(text)) {
        App.snapshot("Renumber IDs");
        numberCases(suite, App.state.project);
        return { reply: "IDs renumbered from 001 in every section.", changed: true };
    }

    if (/^(reset|clear) (all )?(statuses|status|results)/i.test(text)) {
        App.snapshot("Reset statuses");
        allCases(suite).forEach(x => x.c.steps.forEach(s => { s.status = "Untested"; s.actual = ""; }));
        return { reply: "Every step is Untested again and actual results are cleared.", changed: true };
    }

    if ((m = /^(?:find|search|show|filter)(?: for)?\s+(.+)/i.exec(text))) {
        App.setSearch(m[1].replace(/^["']|["']$/g, ""));
        return { reply: `Showing cases that match "${m[1]}".` };
    }

    // names: "use British names instead of Indian names like Priya Shah"
    if (/\bnames?\b/i.test(text) && /\b(british|english|uk|u\.k\.)\b/i.test(text)) return changeNamesCommand(text);

    // mark … as pass
    if ((m = /^mark\s+(.+?)\s+(?:as\s+)?(pass(?:ed)?|fail(?:ed)?|block(?:ed)?|untested|not run|pending)\.?$/i.exec(text))) {
        const status = STATUS_WORDS[m[2].toLowerCase()];
        const stepMatch = /step\s+(\d+)\s+(?:of|in)\s+(.+)/i.exec(m[1]);
        const targets = resolveTargets(suite, stepMatch ? stepMatch[2] : m[1]);
        if (!targets.length) return { reply: `I couldn't find "${m[1]}". Use an ID like ACK_003, a section code, or "all".` };
        App.snapshot("Mark " + status);
        const mark = s => {
            s.status = status;
            if (status === "Pass" && !s.actual.trim()) s.actual = pastTense(s.expected);   // Actual mirrors Expected
        };
        for (let x of targets) {
            if (stepMatch) {
                const step = x.c.steps[Number(stepMatch[1]) - 1];
                if (step) mark(step);
            } else {
                x.c.steps.forEach(mark);
            }
        }
        const noProof = status === "Pass" && !(App.state.project.evidence || "").trim() && targets.some(x => !(x.c.evidence || "").trim());
        return { reply: `Marked ${stepMatch ? "step " + stepMatch[1] + " of " : ""}${ids(targets)} as ${status}.${noProof ? " Pass needs execution evidence — add it under Workbook details (whole run) or with \"set evidence of <ID> to …\"." : ""}`, changed: true };
    }

    // importance
    if ((m = /^(?:set|change|update|make)\s+(?:the\s+)?(?:importance|priority)\s+(?:of|for)\s+(.+?)\s+(?:to|as)\s+(high|medium|low)\.?$/i.exec(text))
        || (m = /^make\s+(.+?)\s+(high|medium|low)(?:\s+(?:priority|importance))?\.?$/i.exec(text))) {
        const targets = resolveTargets(suite, m[1]);
        if (!targets.length) return { reply: `I couldn't find "${m[1]}".` };
        const value = upperFirst(m[2].toLowerCase());
        App.snapshot("Set importance");
        targets.forEach(x => { x.c.importance = value; });
        return { reply: `Importance set to ${value} for ${ids(targets)}.`, changed: true };
    }

    // delete section
    if ((m = /^(?:delete|remove)\s+(?:the\s+)?(?:section|module)\s+([A-Za-z0-9]+)/i.exec(text))) {
        const section = findSection(suite, m[1]);
        if (!section) return { reply: `There is no section ${m[1].toUpperCase()}.` };
        App.snapshot("Delete section");
        suite.sections.splice(suite.sections.indexOf(section), 1);
        return { reply: `Deleted section ${section.code} and its ${section.cases.length} cases.`, changed: true };
    }

    // delete step
    if ((m = /^(?:delete|remove)\s+step\s+(\d+)\s+(?:of|from|in)\s+(.+)/i.exec(text))) {
        const [x] = findCaseRefs(suite, m[2]);
        if (!x) return { reply: `I couldn't find "${m[2]}".` };
        const index = Number(m[1]) - 1;
        if (!x.c.steps[index]) return { reply: `${x.c.id} has only ${x.c.steps.length} steps.` };
        App.snapshot("Delete step");
        x.c.steps.splice(index, 1);
        if (!x.c.steps.length) x.c.steps.push({ action: "", expected: "", actual: "", status: "Untested" });
        return { reply: `Deleted step ${m[1]} of ${x.c.id}.`, changed: true };
    }

    // delete cases
    if ((m = /^(?:delete|remove)\s+(.+)/i.exec(text))) {
        const targets = resolveTargets(suite, m[1]);
        if (!targets.length) return { reply: `I couldn't find "${m[1]}".` };
        App.snapshot("Delete cases");
        const removed = ids(targets);
        for (let x of targets) x.section.cases.splice(x.section.cases.indexOf(x.c), 1);
        suite.sections = suite.sections.filter(s => s.cases.length);
        new Set(targets.map(x => x.section)).forEach(s => renumberSection(s, App.state.project));
        return { reply: `Deleted ${removed}. The remaining cases in the module were renumbered without gaps.`, changed: true };
    }

    // rename section
    if ((m = /^rename\s+(?:the\s+)?(?:section|module)?\s*([A-Za-z0-9]+)\s+(?:to|as)\s+(.+)/i.exec(text))) {
        const section = findSection(suite, m[1]);
        if (!section) return { reply: `There is no section ${m[1].toUpperCase()}.` };
        App.snapshot("Rename section");
        section.title = m[2].trim().replace(/^["']|["']$/g, "");
        section.name = section.title;
        return { reply: `Section ${section.code} is now "${section.title}".`, changed: true };
    }

    // add case(s)
    if ((m = /^add\s+(?:a\s+|new\s+)?(?:test\s+)?cases?\s+(?:to|in|under)\s+([A-Za-z0-9]+)\s*[:\-]?\s*([\s\S]+)/i.exec(text))) {
        const parsed = parseScenarios(m[2]);
        if (!parsed.length) return { reply: "Write the case after the colon, e.g. add case to ACK: Verify … then lines like - Select Save => The record should be saved." };
        App.snapshot("Add case");
        let section = findSection(suite, m[1]);
        if (!section) {
            section = { code: m[1].toUpperCase(), name: m[1].toUpperCase(), title: m[1].toUpperCase(), cases: [] };
            suite.sections.push(section);
        }
        const module = App.state.modules.find(x => x.code.toUpperCase() === section.code);
        const pre = (module && module.precondition) || App.state.project.basePre || "";
        const added = parsed.map(p => {
            const c = {
                id: nextId(section), importance: p.importance, description: p.description, pre: p.pre || pre,
                data: p.refs.length ? p.refs.map(r => {
                    const d = App.state.data.find(x => x.item.toLowerCase() === r.toLowerCase());
                    return d ? `${d.item}: ${d.value}` : `${r}: <add to Test Data>`;
                }).join("\n") : NO_DATA,
                steps: (p.steps.length ? p.steps : [{ action: "", expected: "" }]).map(s => ({ ...s, actual: "", status: "Untested" })),
            };
            section.cases.push(c);
            return c;
        });
        return { reply: `Added ${ids(added)} to ${section.code}.`, changed: true };
    }

    // add step
    if ((m = /^add\s+(?:a\s+)?step\s+(?:to|in)\s+(\S+(?:\s\d+)?)\s*[:\-]\s*(.+)/i.exec(text))) {
        const [x] = findCaseRefs(suite, m[1]);
        if (!x) return { reply: `I couldn't find "${m[1]}".` };
        const [action, expected = ""] = m[2].split("=>").map(s => s.trim());
        App.snapshot("Add step");
        const blank = x.c.steps.length === 1 && !x.c.steps[0].action && !x.c.steps[0].expected;
        if (blank) x.c.steps.pop();
        x.c.steps.push({ action: sentenceNoDot(action), expected: expected ? sentence(expected) : "", actual: "", status: "Untested" });
        return { reply: `Added step ${x.c.steps.length} to ${x.c.id}.`, changed: true };
    }

    // set field
    // run evidence for the whole suite: "set evidence to QA build 4.2.1, run by Emma Clarke, 23/10/2026"
    if ((m = /^(?:set|add|record)\s+(?:the\s+)?(?:run\s+|execution\s+|test\s+)?evidence\s+(?:to|as|:)\s*([\s\S]+)/i.exec(text))) {
        App.snapshot("Set evidence");
        App.state.project.evidence = m[1].trim().replace(/^["“]|["”]$/g, "");
        return { reply: `Execution evidence recorded for the whole run: ${App.state.project.evidence}. Passed cases now meet the team validator.`, changed: true };
    }

    if ((m = /^(?:set|change|update|edit|add)\s+(?:the\s+)?(precondition|preconditions|pre|description|title|summary|test data|data|expected result|expected|actual result|actual|test step|step|action|execution evidence|evidence)\s+(?:of|for|in|on|to)\s+(.+?)\s+(?:to|as)\s+([\s\S]+)/i.exec(text))) {
        const field = FIELD_WORDS[m[1].toLowerCase()];
        const stepMatch = /^(.+?)\s+step\s+(\d+)$/i.exec(m[2]) || /^step\s+(\d+)\s+(?:of|in)\s+(.+)$/i.exec(m[2]);
        let target = m[2];
        let stepNo = null;
        if (stepMatch) {
            if (/^step/i.test(m[2])) { stepNo = Number(stepMatch[1]); target = stepMatch[2]; }
            else { target = stepMatch[1]; stepNo = Number(stepMatch[2]); }
        }
        const targets = resolveTargets(suite, target);
        if (!targets.length) return { reply: `I couldn't find "${target}".` };
        const value = m[3].trim().replace(/^["“]|["”]$/g, "");
        const stepField = ["expected", "actual", "action"].includes(field);
        if (stepField && stepNo === null && targets.some(x => x.c.steps.length > 1)) {
            return { reply: `Which step? e.g. "set ${m[1]} of ${targets[0].c.id} step 2 to …"` };
        }
        App.snapshot("Edit " + m[1]);
        for (let x of targets) {
            if (stepField) {
                const step = x.c.steps[(stepNo || 1) - 1];
                if (step) step[field] = field === "action" ? sentenceNoDot(value) : value;
            } else if (field === "importance") {
                x.c.importance = normImportance(value);
            } else {
                x.c[field] = field === "description" ? verify(value) : value;
            }
        }
        return { reply: `Updated ${m[1]}${stepNo ? " (step " + stepNo + ")" : ""} for ${ids(targets)}.`, changed: true };
    }

    // replace text — "replace X with Y", "use X instead of Y", "change X to Y" (quotes optional)
    let swapPair = null;
    if ((m = /^replace\s+["“']?(.+?)["”']?\s+(?:with|by)\s+["“']?(.*?)["”']?(?:\s+in\s+([A-Za-z0-9_ ,]+))?$/i.exec(text))) swapPair = { from: m[1], to: m[2], scope: m[3] };
    else if ((m = /^(?:use|say|write|put)\s+["“']?(.+?)["”']?\s+(?:instead of|rather than|in place of)\s+["“']?(.+?)["”']?$/i.exec(text))) swapPair = { from: m[2], to: m[1] };
    else if ((m = /^(?:change|rename|update|swap)\s+(?:the\s+)?(?:name\s+|word\s+|text\s+)?["“']?(.+?)["”']?\s+(?:to|into|with|for)\s+["“']?(.+?)["”']?$/i.exec(text))) swapPair = { from: m[1], to: m[2] };
    if (swapPair) {
        const { from, to, scope } = swapPair;
        if (!from.trim()) return { reply: "Say what to replace, e.g. replace Priya Shah with Emma Clarke." };
        App.snapshot("Replace text");
        let count = 0;
        if (scope) {
            const targets = resolveTargets(suite, scope);
            const swap = value => { const parts = String(value || "").split(from); count += parts.length - 1; return parts.join(to); };
            for (let x of targets) {
                for (let f of ["description", "pre", "data"]) x.c[f] = swap(x.c[f]);
                x.c.steps.forEach(s => { s.action = swap(s.action); s.expected = swap(s.expected); s.actual = swap(s.actual); });
            }
        } else {
            count = replaceEverywhere(from, to);
        }
        if (!count) { App.undo(); return { reply: `"${from}" was not found${scope ? " in " + scope : ""}.` }; }
        // People's names are remembered so Generate keeps the new name
        const isPerson = peopleNames().some(n => n.toLowerCase() === to.toLowerCase()) || /^[A-Z][a-z]+(\s+[A-Z][a-zA-Z'-]*)?$/.test(from) && isIndianName(from);
        if (isPerson && !scope) rememberReplacement(from, to);
        return { reply: `Replaced ${count} occurrence${count === 1 ? "" : "s"} of "${from}" with "${to}"${scope ? "" : ", including Test Data"}.`, changed: true };
    }

    // move
    if ((m = /^move\s+(.+?)\s+(?:to|into)\s+([A-Za-z0-9]+)$/i.exec(text))) {
        const section = findSection(suite, m[2]);
        if (!section) return { reply: `There is no section ${m[2].toUpperCase()}.` };
        const targets = findCaseRefs(suite, m[1]);
        if (!targets.length) return { reply: `I couldn't find "${m[1]}".` };
        App.snapshot("Move cases");
        for (let x of targets) {
            x.section.cases.splice(x.section.cases.indexOf(x.c), 1);
            x.c.id = nextId(section);
            section.cases.push(x.c);
        }
        suite.sections = suite.sections.filter(s => s.cases.length);
        new Set(targets.map(x => x.section)).forEach(s => renumberSection(s, App.state.project));
        return { reply: `Moved to ${section.code} as ${ids(targets)}.`, changed: true };
    }

    // duplicate
    if ((m = /^(?:duplicate|copy|clone)\s+(.+)/i.exec(text))) {
        const targets = findCaseRefs(suite, m[1]);
        if (!targets.length) return { reply: `I couldn't find "${m[1]}".` };
        App.snapshot("Duplicate");
        const copies = targets.map(x => {
            const copy = structuredClone(x.c);
            copy.id = nextId(x.section);
            copy.steps.forEach(s => { s.status = "Untested"; s.actual = ""; });
            x.section.cases.splice(x.section.cases.indexOf(x.c) + 1, 0, copy);
            return copy;
        });
        return { reply: `Created ${ids(copies)}.`, changed: true };
    }

    return { reply: `I didn't understand that one offline. Try one of these:\n${suggestCommands(text).map(s => "• " + s).join("\n")}\nType "help" for everything Commands mode can do, or switch to Smart for any other request.` };
}

// ---------- Smart mode ----------
// Smart never edits the suite directly: commands go to the server-side Smart service (ai-service.js) and come back
// as proposals that are validated (ai-response-validator.js) and reviewed (ai-change-review.js) before anything changes.

// ---------- Panel UI ----------

const Chat = {
    busy: false,

    init() {
        this.panel = document.getElementById("assistant");
        this.list = document.getElementById("chatMessages");
        this.input = document.getElementById("chatInput");
        this.sendBtn = document.getElementById("chatSend");
        this.settings = document.getElementById("chatSettings");

        document.getElementById("chatForm").addEventListener("submit", e => { e.preventDefault(); this.send(); });
        this.input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); }
        });
        this.input.addEventListener("input", () => this.autosize());

        document.querySelectorAll("[data-chat-mode]").forEach(b => b.addEventListener("click", () => {
            App.state.ai.enabled = b.dataset.chatMode === "ai";
            App.save();
            this.renderMode();
        }));
        document.getElementById("useSources").addEventListener("change", e => {
            App.state.ai.useSources = e.target.checked;
            App.save();
        });
        document.getElementById("chatKeyBtn").addEventListener("click", () => this.openSettings());
        document.getElementById("chatSettingsClose").addEventListener("click", () => { this.settings.hidden = true; });
        document.getElementById("chatClear").addEventListener("click", () => {
            App.state.chat = [];
            App.save();
            this.render();
        });
        this.list.addEventListener("click", e => {
            const chip = e.target.closest("[data-suggest]");
            if (chip) { this.input.value = chip.dataset.suggest; this.autosize(); this.input.focus(); }
            if (e.target.closest("[data-undo]")) {
                const ok = App.undo();
                this.push("assistant", ok ? "Undone." : "Nothing to undo.", "cmd");
            }
            if (e.target.closest("[data-review]") && SmartReview.current) $("smartReviewDialog").showModal();
        });
        this.renderMode();
        this.render();
    },

    autosize() {
        this.input.style.height = "auto";
        this.input.style.height = Math.min(this.input.scrollHeight, 180) + "px";
    },

    openSettings() {
        SmartSettings.open();
    },

    renderMode() {
        const ai = App.state.ai.enabled;
        document.querySelectorAll("[data-chat-mode]").forEach(b => b.classList.toggle("active", (b.dataset.chatMode === "ai") === ai));
        this.input.placeholder = ai
            ? "Describe what to improve — you review every change before it is applied"
            : "Type a command, e.g. mark ACK_003 as pass — or 'help'";
        const toggle = document.getElementById("sourcesToggle");
        toggle.hidden = !ai || !Sources.list.length;
        document.getElementById("sourcesCount").textContent = Sources.summary() || "0";
        document.getElementById("useSources").checked = App.state.ai.useSources !== false;
        document.getElementById("chatModeNote").textContent = ai
            ? (SmartSettings.ready() ? "Smart mode · suggestions you approve" : "Smart mode · not connected")
            : "Commands mode · works offline";
        if (typeof SmartCommands !== "undefined") SmartCommands.renderTools();
    },

    push(role, text, mode, extra = {}) {
        App.state.chat.push({ role, text, mode, ...extra });
        if (App.state.chat.length > 60) App.state.chat.splice(0, App.state.chat.length - 60);
        App.save();
        this.render();
    },

    render() {
        const msgs = App.state.chat;
        if (!msgs.length) {
            this.list.innerHTML = `
                <div class="chat-empty">
                    <div class="chat-empty-icon">✦</div>
                    <p><strong>Update your test cases by chatting.</strong></p>
                    <p>Commands work offline. Smart suggests changes you review and approve.</p>
                    <div class="chat-chips">
                        ${["help", "check", "summary", "mark all CIN as pass", "set importance of EDG cases to low", "use British names"]
                            .map(s => `<button type="button" class="chip" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}
                    </div>
                </div>`;
            return;
        }
        // Undo always reverts the most recent change, so only the newest message offers it
        const last = msgs.length - 1;
        this.list.innerHTML = msgs.map((m, i) => `
            <div class="msg msg-${m.role}">
                <div class="msg-bubble">${escapeHtml(m.text).replace(/\n/g, "<br>")}</div>
                ${m.changed && i === last ? `<button type="button" class="msg-undo" data-undo>Undo</button>` : ""}
                ${m.review && i === last && SmartReview.current ? `<button type="button" class="msg-undo" data-review>Review changes</button>` : ""}
            </div>`).join("") + (this.busy ? `<div class="msg msg-assistant"><div class="msg-bubble typing"><span></span><span></span><span></span><em id="chatTimer"></em></div></div>` : "");
        this.list.scrollTop = this.list.scrollHeight;
    },

    async send() {
        if (this.busy) {
            SmartService.stop();
            return;
        }
        const text = this.input.value.trim();
        if (!text) return;
        const mode = App.state.ai.enabled && !/^(undo|help)\b/i.test(text) ? "ai" : "cmd";
        this.input.value = "";
        this.autosize();
        this.push("user", text, mode);
        if (mode === "ai") {
            await SmartCommands.run(text);
            return;
        }
        const result = runCommand(text);
        if (result.changed) App.afterChange();
        this.push("assistant", result.reply, mode, { changed: !!result.changed });
    },

    setBusy(busy) {
        this.busy = busy;
        this.sendBtn.classList.toggle("stop", busy);
        this.sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
        clearInterval(this.timer);
        this.render();
        if (busy) {
            const start = Date.now();
            this.timer = setInterval(() => {
                const el = document.getElementById("chatTimer");
                if (el) el.textContent = "Working… " + Math.round((Date.now() - start) / 1000) + "s";
            }, 1000);
        }
    },
};
