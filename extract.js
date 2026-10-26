// Offline reader — no AI, no API key.
// Turns the text of uploaded release notes, specs, slides, PDFs and the test basis into
// (1) the required Setup parameters and (2) scenarios in the Standard v3 style, which the normal generator builds.
// Screenshots and video frames are images: their text can only be read by AI.

const MODULE_KEYWORDS = {
    CFG: ["setting", "configuration", "configure", "toggle", "flag", "app settings", "clock settings", "global settings", "tile", "enable "],
    NOT: ["clock-out note", "note step", "notes configuration", "policy reminder", " note "],
    ACK: ["acknowledg", "punches to review", "punch review"],
    SCF: ["shift confirmation", "scheduled shift", "actual shift"],
    ATT: ["attestation", "question", "reason"],
    ESN: ["e-sign", "signature"],
    PRV: ["pending"],
    LNG: ["spanish", "language", "en/es", "translation", "español"],
    DSH: ["dashboard", "review actions", "manager review", "resolved", "awaiting action", "needing action"],
    HOM: ["upcoming shifts", "side menu", "home screen"],
    CIN: ["clock in", "clock-in", "job code", "greeting"],
    SFT: ["active shift", "clock out", "clock-out", "tip amount", "switch job code", "shift active"],
    BRK: ["break"],
    SCH: ["my punches", "my schedule", "schedule"],
};

const PRODUCTS = ["Zip Clock", "Plum Clock", "Plum Timeclock", "Time Clock", "Zip Schedules", "Zip Inventory", "Zip Checklist", "Plum POS"];

const VERBS = new Set(("tap click select open enter answer choose turn go navigate review scroll expand collapse save submit press swipe type upload " +
    "drag log sign change add delete remove edit correct set check uncheck switch start end clock confirm report acknowledge resolve apply clear " +
    "search filter export print close return wait complete proceed use assign create enable disable fill pick leave declare").split(" "));

// A statement verb early in the sentence means it describes the screen ("Review Actions shows …", "Report, Confirm and Save are disabled …")
const STATEMENT_VERB = /^(?:\S+\s+){0,7}?(is|are|shows|appears|opens|lists|reads|has|have|stays|remains|leaves|updates|displays|contains|includes|resolves)\b/i;

// Common words that start a description; anything else (Attestation Report, NOTE step) keeps its capital
const COMMON_START = /^(The|A|An|This|That|These|Those|Each|Every|Any|All|Only|Both|Its|Their|Some|No|One)\b|^[A-Z][a-z]+ing\b/;

function descStart(s) {
    // "The menu …", "Handled punches …" → lower case; "Attestation Report …", "NOTE step …", "Zip Clock …" keep their capitals
    const ordinary = COMMON_START.test(s) || (/^[A-Z][a-z]+\s+[a-z]/.test(s) && !PRODUCTS.some(p => s.startsWith(p.split(" ")[0] + " ")));
    return ordinary ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Keep quoted UI text intact while matching grammar rules
function protectQuotes(s) {
    const quotes = [];
    const text = s.replace(/"[^"]*"|“[^”]*”/g, m => { quotes.push(m); return `\u0001${quotes.length - 1}\u0001`; });
    return { text, restore: t => t.replace(/\u0001(\d+)\u0001/g, (_, i) => quotes[Number(i)]) };
}

const GERUND = { tap: "tapping", click: "clicking", select: "selecting", open: "opening", enter: "entering", answer: "answering", choose: "choosing", turn: "turning",
    go: "going", review: "reviewing", save: "saving", submit: "submitting", set: "setting", log: "logging", swipe: "swiping", drag: "dragging", type: "typing" };

// ---------- Text helpers ----------

// "The Tip step should show Cash and Credit fields." → "Verify the Tip step shows Cash and Credit fields."
function verifyFromExpected(expected) {
    const text = String(expected || "").replace(/^to confirm:\s*/i, "").trim();
    const m = /^(.*?)\bshould\s+(not\s+|no longer\s+)?(\w+)(.*)$/i.exec(text);
    if (!m) return verify(text);
    const [, subject, modifier = "", verb, rest] = m;
    const plural = /\band\b/i.test(subject) || /s\s*$/.test(subject.trim()) && !/(?:ss|us|is)\s*$/.test(subject.trim());
    const v = verb.toLowerCase();
    const present = v === "be" ? (plural ? "are" : "is") : v === "have" ? (plural ? "have" : "has")
        : plural ? v : /(?:s|sh|ch|x|o)$/.test(v) ? v + "es" : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + "ies" : v + "s";
    const mod = modifier.trim().toLowerCase();
    const phrase = mod === "not" ? (v === "be" ? `${present} not` : `${plural ? "do" : "does"} not ${v}`) : mod ? `${present === "is" || present === "are" ? present + " " + mod : mod + " " + present}` : present;
    return verify(`${subject.trim()} ${phrase}${rest}`);
}

function cleanLine(s) {
    const t = s.replace(/\s+/g, " ").replace(/\*\*|__|`/g, "").trim();
    // The document is a reference, never the system under test: drop "(Fig : 1.1)", "see Slide 3" and similar
    // (headings keep them — slide headings are read separately)
    if (/^#/.test(t)) return t;
    const stripped = t.replace(DOC_REF, " ");
    if (stripped === t) return t;
    // Tidy only what removing the reference left behind; bullets ("- …") are kept
    return stripped.replace(/\(\s*\)/g, "").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s:,;.]+/, "").trim();
}

// Split into sentences without breaking quoted text
function sentences(text) {
    const quotes = [];
    const protectedText = text.replace(/"[^"]*"|“[^”]*”/g, m => { quotes.push(m); return `\u0000${quotes.length - 1}\u0000`; });
    return protectedText.split(/(?<=[.!?])\s+(?=[A-Z"\u0000(])|;\s+/)
        .map(s => s.replace(/\u0000(\d+)\u0000/g, (_, i) => quotes[Number(i)]).trim())
        .map(s => s.replace(/^(and|then)\s+/i, "").trim())
        .filter(s => s.replace(/[.\s]/g, "").length > 1);
}

function stripEnd(s) {
    return s.replace(/\s*\((?:observed|release notes|optional)[^)]*\)\s*/gi, " ").replace(/[.;:,\s]+$/, "").trim();
}

function firstWord(s) {
    return (s.match(/^[A-Za-z-]+/) || [""])[0].toLowerCase();
}

function isImperative(s) {
    const w = firstWord(s);
    if (!VERBS.has(w)) return false;
    if (w === "tap" || w === "click") return true;
    return !STATEMENT_VERB.test(protectQuotes(s).text);
}

// "NOTE step: the configured note is shown" → { label: "NOTE step", rest: "the configured note is shown" }
function splitLabel(s) {
    const m = /^([A-Z][\w ,&/'-]{0,40}):\s+(.+)$/.exec(s);
    return m && m[1].split(" ").length <= 5 && !/^(observed|note|example|e\.g)$/i.test(m[1]) ? { label: m[1], rest: m[2] } : { label: "", rest: s };
}

function gerund(action) {
    const [verb, ...rest] = action.split(" ");
    const v = verb.toLowerCase();
    const g = GERUND[v] || (v.endsWith("e") && !v.endsWith("ee") ? v.slice(0, -1) + "ing" : v + "ing");
    return [g, ...rest].join(" ");
}

function baseVerb(v) {
    const w = v.toLowerCase();
    if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (/ies$/.test(w)) return w.slice(0, -3) + "y";
    return w.replace(/s$/, "");
}

function capitalise(s) {
    if (/^(it|this|they)\b/i.test(s)) return "The screen" + s.replace(/^\w+/, "");
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Replace <name>, <time>, <n> … with concrete sample values
function concrete(s, ctx) {
    const values = {
        "name": ctx.employee || "Andrew", "employee": ctx.employee || "Andrew", "time": "05:31 PM", "start time": "01:00 PM",
        "n": "2", "count": "2", "date": "10/20/2026", "job code": ctx.jobCode || "Cleaner", "job role": ctx.jobCode || "Cleaner",
        "role": ctx.jobCode || "Cleaner", "start": "09:00 AM", "end": "05:00 PM", "day": "Wed", "position": "Cook", "timer": "00:15:00",
    };
    return s
        // "<n>m allocated", "<n> min" → a realistic duration
        .replace(/<\s*n\s*>(?=\s*m(?:in)?\b)/gi, "30")
        // <JOB CODE> → CLEANER, <job code> → Cleaner: keep the capitals of the placeholder
        .replace(/<\s*([a-z ]+?)\s*>/gi, (m, key) => {
            const v = values[key.toLowerCase()];
            if (!v) return m;
            return key === key.toUpperCase() && /[A-Z]/.test(key) ? v.toUpperCase() : v;
        })
        // Cross-references to other basis files: "(and Reported Acknowledgement, see 02)", "See 02."
        .replace(/\s*\((?:[^()]*\bsee\s+\d+[^()]*)\)/gi, "").replace(/[,;]?\s*\bsee\s+\d+\b\.?/gi, "");
}

// A release-note statement → one Standard v3 expected result (exactly one "should"), or null
function toShould(raw) {
    let c = stripEnd(raw.replace(/^observed:?\s*/i, "").replace(/\s*observed\.?$/i, ""));
    if (!c) return null;
    c = c.replace(/^(and|then|also)\s+/i, "");
    // "Left: a profile card …", "Right, top: …", "NOTE step: …" → the part after the label
    const { label, rest } = splitLabel(c);
    c = rest;
    // "With all punches handled, the step shows …" → convert the main clause, keep the condition at the end
    const { lead, rest: main } = splitLead(c);
    if (lead) {
        const inner = toShould(main);
        if (inner) return inner.replace(/\.$/, "") + ` ${lead}.`;
    }
    const q = protectQuotes(c);
    let t = q.text;
    if (/\bshould\b/i.test(t)) return capitalise(q.restore(t)) + ".";

    // "… when Spanish is selected" → match the main clause, keep the condition
    let condition = "";
    const cond = /^(.+?)\s+((?:when|if|once|after|until|unless|before)\s+.+)$/i.exec(t);
    if (cond && cond[1].split(" ").length >= 2) { t = cond[1]; condition = " " + cond[2]; }

    const hasVerb = /\b(is|are|shows|appears|opens|reads|lists|has|have|stays|remains|leaves|updates|displays|changes|can)\b/i.test(t);
    // "NOTE step: the configured note is shown" → "The NOTE step should show the configured note."
    // "Switch Job Code card: "Currently working as …"" → "The Switch Job Code card should show "…"."
    if (label && /\b(step|pop-?up|screen|section|tab|card|page|panel|menu|dialog|window|banner|button|pill|header|footer)\b/i.test(label)) {
        const shown = /^(.+?)\s+(?:is|are)\s+(?:shown|displayed)$/i.exec(t) || /^(.+?)\s+appears?$/i.exec(t);
        if (shown) return q.restore(`The ${label} should show ${shown[1].replace(/^The /, "the ")}${condition}`) + ".";
        if (!hasVerb) return q.restore(`The ${label} should show ${t.replace(/^The /, "the ")}${condition}`) + ".";
    }
    // "Left: a profile card …" / "Bottom: the Clock In button" / "Clock Out: at the bottom" → where it is displayed
    const POSITION = { "left": "on the left", "right": "on the right", "top": "at the top", "bottom": "at the bottom", "right, top": "at the top right",
        "right, middle": "in the middle on the right", "right, lower": "lower on the right", "left, top": "at the top left", "top card": "in the top card", "left card": "in the left card" };
    if (label && POSITION[label.toLowerCase()] && !hasVerb) {
        return capitalise(q.restore(`${t} should be displayed ${POSITION[label.toLowerCase()]}`)) + ".";
    }
    if (label && /^(at|on|in|under|below|above|next to|beside)\b/i.test(t)) {
        return q.restore(`${label} should be displayed ${t}`) + ".";
    }

    const notInfinitive = s => !/\bto$/i.test(s.trim());
    const rules = [
        [/^(.+?)\s+(?:appears|is shown|are shown|is displayed|are displayed|shows up|pops up)\b(.*)$/i, m => `${m[1]} should be displayed${m[2]}`],
        [/^(.+?\b(?:pop-up|popup|window|screen|step|dialog|page|menu|panel|tab|form|wizard|editor))\s+opens\b(.*)$/i, m => `${m[1]} should open${m[2]}`],
        [/^(.+?)\s+(?:shows|displays)\s+(.+)$/i, m => `${m[1]} should show ${m[2]}`],
        [/^(.+?)\s+reads\s+(.+)$/i, m => `${m[1]} should read ${m[2]}`],
        [/^(.+?)\s+lists\s+(.+)$/i, m => `${m[1]} should list ${m[2]}`],
        [/^(.+?)\s+(?:is|are)\s+(disabled|enabled|hidden|visible|highlighted|selected|required|available|saved|resolved|removed|updated|paginated|cleared|checked|unchecked|collapsed|expanded|listed|recorded|ordered|sorted|marked|labelled|labeled|outlined|shown|displayed)\b(.*)$/i, m => `${m[1]} should be ${m[2] === "shown" ? "displayed" : m[2]}${m[3]}`],
        [/^(.+?)\s+(?:stays|remains)\s+(.+)$/i, m => `${m[1]} should stay ${m[2]}`],
        [/^(.+?)\s+has\s+(.+)$/i, m => `${m[1]} should have ${m[2]}`],
        [/^(.+?)\s+leaves\s+(.+)$/i, m => `${m[1]} should leave ${m[2]}`],
        [/^(.+?)\s+goes\s+(?:to\s+)?(.+)$/i, m => `${m[1]} should go to ${m[2]}`],
        [/^(.+?)\s+(updates|decreases|increases|changes|closes|completes|moves|switches|returns|expands|collapses|counts|refreshes|disappears|loads|replaces|uses|offers|contains|includes|starts|ends|resets|keeps|matches|follows|records|saves|resolves|removes|adds|sends|clears|marks|confirms|submits|navigates|scrolls|filters|sorts|groups|links)\b(.*)$/i, m => `${m[1]} should ${baseVerb(m[2])}${m[3]}`],
        // Plural subjects: "The note, questions and reasons use the ES text", "Handled punches leave the list"
        [/^(.+?\b(?:and|both)\b.+?|(?:the\s+|all\s+)?[\w-]+(?:\s+[\w-]+){0,3}?[^s\s]s)\s+(use|show|display|appear|open|list|read|have|stay|leave|update|include|contain|match|move|change|disappear|remain)\b(.*)$/i, m => `${m[1]} should ${m[2].toLowerCase()}${m[3]}`],
        [/^(.+?)\s+can\s+(.+)$/i, m => `${m[1]} should be able to ${m[2]}`],
    ];
    for (let [re, fn] of rules) {
        const m = re.exec(t);
        if (m && notInfinitive(m[1]) && m[1].split(" ").length <= 14) return capitalise(q.restore(fn(m).trim() + condition)) + ".";
    }
    // "The Resolved icon resolves the item" — any 3rd-person verb followed by an object
    const generic = /^((?:the|a|an)\s+.+?)\s+([a-z]{3,}(?:es|s))(?=\s+(?:the|a|an|to|it|them|all|each|every|\u0001)|$)(.*)$/i.exec(t);
    if (generic && !/(ss|us|is|ous)$/.test(generic[2]) && generic[1].split(" ").length <= 10) {
        return capitalise(q.restore(`${generic[1]} should ${baseVerb(generic[2])}${generic[3]}${condition}`)) + ".";
    }
    // A noun phrase from an "Observed:" list, a screen description, a quoted label or a toast → it is displayed
    if (!condition && t.split(" ").length <= 30 && !/\b(is|are|was|were|will|can|must)\b/i.test(t)) {
        const toast = /\btoast\s+(\u0001\d+\u0001)$/i.exec(t);
        return capitalise(q.restore(toast ? toast[1] : t)) + " should be displayed.";
    }
    return null;
}

// Several observations or actions in one sentence → one clause each
// ("Select punches, then Report", "a loader, then the toast …", "X completes and the pop-up appears", "Or Confirm, and the Status shows …")
function splitObservations(sentence) {
    // Keep a leading condition with the clause it belongs to
    const { lead, rest } = splitLead(sentence.replace(/^observed:?\s*/i, ""));
    if (lead) {
        const clauses = splitObservations(rest);
        clauses[0] = `${lead.charAt(0).toUpperCase() + lead.slice(1)}, ${clauses[0]}`;
        return clauses;
    }
    const q = protectQuotes(sentence.replace(/^observed:?\s*/i, ""));
    return q.text.split(/;\s+|,\s+then\s+|,\s+(?:and\s+)?(?=(?:the|a|an)\s)|\s+and\s+(?=(?:the|a|an)\s+[\w-]+(?:\s+[\w-]+){0,3}\s+(?:is|are|appears|shows|opens|reads|lists|leaves|updates|stays|remains|closes|completes)\b)/i)
        .map(p => q.restore(p).trim().replace(/^(or|and)\s+/i, "")).filter(Boolean);
}

// "With all punches handled, the step shows …" → { lead: "with all punches handled", rest: "the step shows …" }
function splitLead(s) {
    const m = /^(With|When|If|After|Once|On|In|Under|From|Within|While|Before)\b([^,"]{2,70}),\s*(.+)$/.exec(s);
    return m ? { lead: (m[1] + m[2]).replace(/^./, c => c.toLowerCase()), rest: m[3] } : { lead: "", rest: s };
}

// "a punch is selected" → "Select a punch"
function conditionToAction(cond) {
    const m = /^(an?|the|at least one)?\s*(.+?)\s+(?:is|are)\s+(selected|chosen|entered|checked|answered|filled|saved)$/i.exec(cond.trim());
    if (!m) return "Make sure " + cond.trim();
    const verb = { selected: "Select", chosen: "Choose", entered: "Enter", checked: "Check", answered: "Answer", filled: "Fill", saved: "Save" }[m[3].toLowerCase()];
    return `${verb} ${m[1] ? m[1].toLowerCase() + " " : ""}${m[2]}`;
}

// "On the ongoing punch screen, tap Clock Out, then Next" → ["Tap Clock Out on the ongoing punch screen", "Tap Next"]
function actionsFrom(sentence) {
    let s = stripEnd(sentence).replace(/\s*\([^)]*\)/g, "");
    let context = "";
    const lead = /^(On|Under|In|From|At|When|If|After|Before|With|Within)\b([^,]{2,60}),\s*(.+)$/.exec(s);
    if (lead && isImperative(lead[3])) {
        context = ` ${lead[1].toLowerCase()}${lead[2]}`;
        s = lead[3];
    }
    if (!isImperative(s)) return [];
    // "Correct the punch, choose an Adjustment Reason, then Save" → three actions
    const verbAlt = [...VERBS].join("|");
    const parts = s.split(new RegExp(`,?\\s+then\\s+|,\\s+and then\\s+|,\\s+(?:and\\s+)?(?=(?:${verbAlt})\\b)`, "i")).map(p => p.trim()).filter(Boolean);
    return parts.map((p, i) => {
        // A bare button name ("Proceed", "Submit", "Accept & e-Sign") is tapped
        const button = p.split(" ").length <= 4 && p.split(" ").every(w => /^[A-Z&]/.test(w) || /^(to|of|and|or|&)$/.test(w))
            && !/^(tap|click|select|press|choose|open|enter)\b/i.test(p);
        let a = button || !isImperative(p) ? `Tap ${p}` : p;
        a = a.charAt(0).toUpperCase() + a.slice(1);
        return i === 0 ? a + context : a;
    });
}

// An action the notes don't describe the result of: a fitting, honest "To confirm" result
function genericResult(action) {
    const m = /^(choose|select|pick|answer)\s+(?:an?|the)?\s*(.+?)(?:\s+(?:for|on|in|under|where)\b.*)?$/i.exec(action);
    if (m && !/^(yes|no)\b/i.test(m[2])) return `To confirm: The ${m[2].replace(/^the\s+/i, "")} should be selected.`;
    if (/^answer\b/i.test(action)) return "To confirm: The answer should be selected.";
    if (/^(enter|type|correct|fill|edit|change)\b/i.test(action)) return "To confirm: The new value should be displayed.";
    if (/^(turn on|enable|check)\b/i.test(action)) return "To confirm: The option should be on.";
    if (/^(turn off|disable|uncheck)\b/i.test(action)) return "To confirm: The option should be off.";
    return "To confirm: The next screen should be displayed.";
}

// "The view (eye) icon opens Attestation Detail" / "Edit Punches opens the Edit Punch window" → a tap and its result
function controlAction(sentence) {
    // "Under Awaiting Action from Others, Pending Acknowledgement opens …" → tap it under Awaiting Action from Others
    const { lead, rest } = splitLead(stripEnd(sentence.replace(/^observed:?\s*/i, "")));
    if (lead) {
        const inner = controlAction(rest);
        return inner && { action: `${inner.action} ${lead}`, expected: inner.expected };
    }
    const s = rest;
    const m = /^(the\s+)?(.+?)\s+(opens|resolves|closes|returns to|expands|collapses|saves|submits|adds|removes|switches|starts|ends)\s+(.+)$/i.exec(s);
    if (!m) return null;
    const subject = m[2].trim();
    const words = subject.replace(/\([^)]*\)/g, "").trim().split(/\s+/);
    const control = /\b(icon|button|link|toggle|arrow|checkbox|tile|tab)\b/i.test(subject)
        || (words.length <= 4 && words.every(w => /^[A-Z]/.test(w)) && !/^(it|this|the|time|zip|plum)$/i.test(words[0]));
    if (!control) return null;
    const target = (m[1] ? "the " : "") + subject;
    const verb = m[3].toLowerCase();
    const object = m[4].trim();
    const expected = verb === "opens" ? `${capitalise(object)} should open.`
        : verb === "returns to" ? `${capitalise(object)} should be displayed.`
        : `${capitalise(target)} should ${baseVerb(verb.split(" ")[0])}${verb.includes(" ") ? " " + verb.split(" ").slice(1).join(" ") : ""} ${object}.`;
    return { action: `Tap ${target}`, expected };
}

function shorten(s, n = 90) {
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s;
}

// ---------- Reading the documents ----------

function collectDocuments() {
    const docs = [];
    const basis = (App.state.basisText || "").trim();
    if (basis) docs.push({ name: "Test basis", text: basis });
    for (let t of Sources.texts()) {
        if (basis && basis.includes(t.text.trim().slice(0, 200))) continue;      // already copied into the basis
        docs.push(t);
    }
    return docs;
}

function parseSections(docs) {
    const sections = [];
    for (let doc of docs) {
        let current = { title: doc.name.replace(/\.[^.]+$/, ""), lines: [], doc: doc.name };
        sections.push(current);
        const lines = doc.text.replace(/\r/g, "").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const t = cleanLine(raw);
            if (!t) continue;
            const md = /^#{1,6}\s+(.+)$/.exec(t);
            const flow = /^((?:flow|scenario|step|part|section)\s+[A-Z0-9]{1,3}\s*[:\-–—].+)$/i.exec(t);
            const colonTitle = t.length < 70 && /:$/.test(t) && !/^\d/.test(t) && !/^[-*•]/.test(t) && t.split(" ").length <= 8;
            // Plain documents: a short title-like line ("Summary", "Impacted areas") followed by more text
            const nextLine = cleanLine(lines[i + 1] || "");
            const plainTitle = !md && !flow && !colonTitle && t.length <= 60 && /^[A-Z]/.test(t) && !/[.;,!?:"]$/.test(t)
                && t.replace(/\([^)]*\)/g, "").trim().split(/\s+/).length <= 7 && t.split(" ").length <= 12
                && !/^\d/.test(t) && nextLine && !/^[a-z]/.test(nextLine) && !/^\s*[-*•]/.test(raw)
                && !/\b(is|are|shows|tap|click|select|should)\b/i.test(t);
            const slide = /^##?\s*Slide\s+(\d+)/i.exec(raw.trim());
            if (md || flow || colonTitle || plainTitle) {
                let title = (md ? md[1] : flow ? flow[1] : t.replace(/:$/, "")).trim();
                if (slide) {
                    const next = cleanLine(lines[i + 1] || "");
                    title = next ? next : title;
                    if (next) i++;
                }
                current = { title: title.replace(/^test basis:\s*/i, ""), lines: [], doc: doc.name };
                sections.push(current);
            } else {
                current.lines.push(raw.replace(/\t/g, " ").replace(/\s+$/, ""));
            }
        }
    }
    // Slide labels such as "Updated Screen" or "New Design" are not screen names: name the section after what
    // its first line describes ("The Tip step shows …" → "Tip step"), or after the section before it
    sections.forEach((s, i) => {
        if (!GENERIC_TITLE.test(s.title.trim())) return;
        const first = cleanLine(s.lines.find(l => cleanLine(l)) || "");
        const subject = /^(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Za-z][\w-]*){0,4}?)\s+(?:shows|displays|lists|has|contains|includes|opens|now)\b/i.exec(first);
        s.title = subject ? subject[1] : (sections[i - 1] && !GENERIC_TITLE.test(sections[i - 1].title) ? sections[i - 1].title : s.title);
    });
    // SUT isolation: the document is a reference, never the system under test. Skip the previous behaviour,
    // marketing headings and closing slides; drop lines that only point at slides or figures.
    return sections
        .filter(s => s.lines.some(l => l.trim()) || s === sections[0])
        .filter(s => s === sections[0] || !NOT_UNDER_TEST.test(s.title))
        .map(s => ({ ...s, lines: s.lines.filter(l => !/^\s*[-*•]?\s*(?:see\s+)?(?:slide\s+\d+|fig(?:ure)?\.?\s*\d[\d.]*)\s*$/i.test(l)) }));
}

// Slide labels that say which version a slide shows, not what the screen is called
const GENERIC_TITLE = /^(?:updated|new|revised|redesigned|current|after|proposed|final)\s+(?:screens?|designs?|ui|layouts?|behaviou?rs?|flows?|versions?|look)$/i;

// Section titles that are never tested: old screens, marketing copy, closing slides
const NOT_UNDER_TEST = /^(?:previous|old|current|existing)\s+(?:screen|behaviou?r|flow|design|version|experience)s?\b|^(?:before|as[- ]is)\b|\b(?:thank\s*you|q\s*&\s*a|questions\?|agenda|key benefits|benefits|value proposition|improved visibility|time savings|consistent experience|why (?:this|it) matters)\b/i;

// Numbered steps with their sub-bullets: [{ n, text }]
function numberedSteps(lines) {
    const steps = [];
    for (let line of lines) {
        const m = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
        const sub = /^\s{1,}[-*•]\s+(.+)$/.exec(line) || (/^\s*[-*•]\s+(.+)$/.exec(line) && steps.length ? /^\s*[-*•]\s+(.+)$/.exec(line) : null);
        if (m) steps.push({ n: Number(m[1]), text: cleanLine(m[2]) });
        else if (sub && steps.length) steps[steps.length - 1].text += " " + cleanLine(sub[1]).replace(/([^.!?"])$/, "$1.");
        else if (steps.length && !/^\s*[-*•#|]/.test(line) && /^\s{2,}\S/.test(line)) steps[steps.length - 1].text += " " + cleanLine(line);
    }
    return steps;
}

// "Flag | Effect" table rows or "- Flag — effect" bullets
function settingRows(lines) {
    const rows = [];
    for (let line of lines) {
        const t = cleanLine(line);
        if (/^\|?\s*-{3,}/.test(t)) continue;
        if (t.includes("|")) {
            const cells = t.split("|").map(c => c.trim()).filter(Boolean);
            if (cells.length >= 2 && !/^(flag|setting|name|option|field)$/i.test(cells[0])) rows.push({ flag: cells[0], effect: cells.slice(1).join(" — ") });
            continue;
        }
        const m = /^[-*•]\s*(.+?)\s+[—–-]\s+(.+)$/.exec(t);
        if (m && m[1].split(" ").length <= 8) rows.push({ flag: m[1], effect: m[2] });
    }
    return rows;
}

function scoreModule(code, text) {
    const lower = " " + text.toLowerCase() + " ";
    return (MODULE_KEYWORDS[code] || []).reduce((n, k) => n + (lower.split(k).length - 1), 0);
}

// ---------- Setup from sources (offline) ----------

function detectSetup(docs, sections) {
    const all = docs.map(d => d.text).join("\n");
    // The title comes from the main document (the one with the most text), not from a deck's file name
    const main = [...docs].sort((a, b) => b.text.length - a.text.length)[0] || { text: "", name: "" };
    const firstLine = cleanLine((main.text.split("\n").find(l => l.trim()) || "").replace(/^#+\s*/, ""));
    const titleLine = ((/^#\s+(.+)$/m.exec(main.text) || [])[1] || firstLine || main.name.replace(/\.[^.]+$/, ""))
        .replace(/^(test basis|release notes?|spec(?:ification)?|requirements?)\s*[:\-–—]\s*/i, "");
    const title = titleLine.replace(/\(.*?\)/g, "").replace(/\s{2,}/g, " ").trim();
    const product = PRODUCTS.find(p => title.toLowerCase().startsWith(p.toLowerCase())) || (/(Zip Clock|Plum Clock|Time Clock)/i.exec(all) || [])[1] || "Zip Clock";
    const enhancement = title.replace(new RegExp("^" + product + "\\s*[-—–:]?\\s*", "i"), "").replace(/^(the|a)\s+/i, "")
        .split(/\s+\+\s+|\s+&\s+(?=[A-Z][\w ]+Report)/)[0].trim() || title;
    const short = (/short code:\s*([A-Z0-9]{2,6})/i.exec(all) || [])[1];
    const words = enhancement.replace(/[^\w\s/]/g, " ").split(/[\s/]+/).filter(w => w && !/^(and|or|the|of|for|to|a|an|on|in|with|screen|screens|side)$/i.test(w));
    // Never derive the prefix from the file name: use a "Short code" from the sources or the enhancement title,
    // otherwise leave it empty so the intake asks for the official acronym.
    const titleFromFile = !(/^#\s+(.+)$/m.exec(main.text)) && !firstLine;
    const prefix = (short || (titleFromFile ? "" : words.map(w => w[0]).join("").slice(0, 4))).toUpperCase();
    const fileName = (enhancement.replace(/[^\w\s-]/g, " ").trim().split(/\s+/).filter(Boolean).join("_") || "Test_Cases") + ".xlsx";

    // Change areas: the flows and new screens the notes describe
    const areaSections = sections.filter(s => /^(flow|new|clock-?in|clock-?out|active shift|break|my |dashboard|manager|report|settings|attestation|shift|pending|language|notes configuration|clock attestation)/i.test(s.title) && !/test data|open question|regression|summary|impacted/i.test(s.title));
    const revamp = /revamp|redesign|revamped|has moved|replaces|previously|now uses|card layout/i.test(all);
    const changeAreas = [...new Set(areaSections.map(s => s.title.replace(/^(flow|scenario)\s+[A-Z0-9]+\s*[:\-–—]\s*/i, "").replace(/\(.*?\)/g, "").trim())
        .filter(t => t && !/^(flow|scenario|steps?|settings?)$/i.test(t)))]
        .slice(0, 10).map(area => ({ area, type: /new|added/i.test(area) && !revamp ? "NEW" : revamp ? "EXISTING-REVAMPED" : "NEW" }));
    if (!changeAreas.length && enhancement) changeAreas.push({ area: enhancement, type: revamp ? "EXISTING-REVAMPED" : "NEW" });

    const surfaces = [];
    const count = re => (all.match(re) || []).length;
    if (/time clock|device|kiosk|clock screen|employee list|\bpin\b|clock[- ]?in|clock[- ]?out|job code|break/i.test(all)) surfaces.push("Time Clock device");
    if (count(/manager|review actions|needing action|awaiting action|\bweb\b|punch management/gi) >= 1 || count(/dashboard/gi) >= 2) surfaces.push("Manager web");
    if (/app settings|global settings|clock settings|site settings|configuration/i.test(all)) surfaces.push("Settings");
    if (/\breports?\b/i.test(all) && !/^[^]*?\bno reports?\b/i.test(all)) surfaces.push("Reports");
    // The mobile app is a surface only when the notes describe its screens, not a pointer to it
    if (count(/mobile app/gi) >= 2 && !/open the [\w ]*mobile app/i.test(all)) surfaces.push("Mobile app");

    // Modules: codes the notes talk about, in the order they first appear
    const order = [];
    const scores = {};
    for (let code of Object.keys(MODULE_KEYWORDS)) {
        scores[code] = scoreModule(code, all);
        const first = Math.min(...MODULE_KEYWORDS[code].map(k => { const i = all.toLowerCase().indexOf(k); return i < 0 ? Infinity : i; }));
        if (scores[code] >= 2) order.push([first, code]);
    }
    let modules = order.sort((a, b) => a[0] - b[0]).map(x => x[1]);
    if (modules.includes("CFG")) modules = ["CFG", ...modules.filter(c => c !== "CFG")];
    // Nothing named twice: the single best match, or none (never a guess)
    if (!modules.length) {
        const best = Object.entries(scores).filter(([c, n]) => n >= 1 && c !== "CFG").sort((a, b) => b[1] - a[1])[0];
        if (best) modules = [best[0]];
    }

    const questions = [];
    for (let s of sections.filter(x => /open question|to confirm|questions/i.test(x.title))) {
        for (let line of s.lines) { const t = cleanLine(line.replace(/^[-*•\d.)\s]+/, "")); if (t) questions.push(t); }
    }
    return { name: `${product} — ${enhancement}`, prefix, fileName, changeAreas, surfaces, modules, questions };
}

function fillSetupOffline() {
    const docs = collectDocuments();
    if (!docs.length) return { error: "No readable text in the sources. Upload release notes, a spec, slides or a PDF with text — or use smart reading for screenshots." };
    const sections = parseSections(docs);
    const d = detectSetup(docs, sections);
    const s = App.state;
    const p = s.project;
    if (!p.name.trim()) p.name = d.name;
    if (!p.code.trim()) p.code = d.prefix;
    if (!(p.fileName || "").trim()) p.fileName = d.fileName;
    p.infix = (SCOPES[s.scope] || SCOPES.changed).infix;
    if (!s.changeAreas.some(a => a.area.trim())) s.changeAreas = d.changeAreas;
    if (!s.surfaces.length) s.surfaces = d.surfaces;
    if (!s.modules.some(m => m.code.trim())) {
        s.modules = d.modules.length ? d.modules.map(code => ({ ...EMPTY_MODULE, code, name: MODULE_NAMES[code], description: MODULE_NAMES[code] })) : [{ ...EMPTY_MODULE }];
    }
    App.save();
    return { data: d, docs: docs.length };
}

// ---------- Scenarios from sources (offline) ----------

function buildScenarios() {
    const docs = collectDocuments();
    const sections = parseSections(docs);
    const all = docs.map(d => d.text).join("\n");
    const s = App.state;
    const codes = s.modules.filter(m => m.code.trim() && !TAIL_SECTIONS[m.code.toUpperCase()]).map(m => m.code.toUpperCase());
    const has = c => codes.includes(c);
    const out = {};                                        // code → scenario lines
    const tail = { RPT: [], REG: [], EDG: [] };
    // Every scenario line stays one line, and only the first "=>" separates step from expected result
    const clean = line => {
        const l = line.replace(/\s*[\r\n]+\s*/g, " ").trim();
        if (!l.startsWith("- ")) return l.replace(/=>/g, "→");
        const i = l.indexOf(" => ");
        return i < 0 ? l : l.slice(0, i).replace(/=>/g, "→") + " => " + l.slice(i + 4).replace(/=>/g, "→");
    };
    const push = (code, lines) => (TAIL_SECTIONS[code] ? tail[code] : (out[code] = out[code] || [])).push(...lines.map(clean), "");
    const dataItems = [];
    const actionNames = new Set();

    // Test data seen in the notes
    const ctx = { employee: "", jobCode: "" };
    for (let sec of sections.filter(x => /test data|data seen|recordings/i.test(x.title))) {
        for (let line of sec.lines) {
            const t = cleanLine(line.replace(/^[-*•]\s*/, ""));
            const parts = t.split(/\.\s+(?=[A-Z])/);
            for (let part of parts) {
                const m = /^([A-Za-z][\w ]{1,30}):\s*(.+?)\.?$/.exec(part);
                if (m) {
                    const label = m[1].trim();
                    const values = m[2].split(/,\s*/).map(v => v.trim()).filter(Boolean);
                    if (/employee|user|people|staff/i.test(label)) {
                        ctx.employee = ctx.employee || values[0].replace(/\s*\(.*$/, "");
                        dataItems.push({ category: "Users", item: "Primary employee", value: `${values[0]}, PIN 1234`, notes: "From the sources; seed the PIN before execution." });
                        if (values[1]) dataItems.push({ category: "Users", item: "Secondary employee", value: `${values[1]}, PIN 5678`, notes: "From the sources; seed the PIN before execution." });
                    } else if (/job code/i.test(label)) {
                        ctx.jobCode = ctx.jobCode || values[0];
                        dataItems.push({ category: "Configuration", item: "Job codes", value: values.join(", "), notes: "From the sources." });
                    } else if (/^site$/i.test(label)) {
                        const site = s.data.find(d => d.item === "Site");
                        if (site) site.value = values[0];
                    } else {
                        dataItems.push({ category: /reason|setting|code/i.test(label) ? "Configuration" : "Records", item: label, value: values.join(", "), notes: "From the sources." });
                    }
                } else if (/\(.+\)/.test(part) && part.split(",").length >= 2) {
                    dataItems.push({ category: "Schedule", item: "Roster from the sources", value: part.replace(/\.$/, ""), notes: "From the sources." });
                    ctx.employee = ctx.employee || part.split(/[ (,]/)[0];
                }
            }
        }
    }
    const employeeRef = dataItems.some(d => d.item === "Primary employee") ? " {Primary employee}" : "";
    const site = (s.data.find(d => d.item === "Site") || {}).value || "Altametrics";
    const devicePre = `Time Clock is online at site ${site}.${ctx.employee ? ` ${ctx.employee} is clocked in.` : ""}`;
    // Clock-in screens need the employee clocked out; shift, break and clock-out screens need them clocked in
    const preFor = (code, text) => {
        if (!ctx.employee) return `Time Clock is online at site ${site}.`;
        if (code === "CIN" || /clock-?in screen|select (a )?job code|greeting/i.test(text)) return `Time Clock is online at site ${site}. ${ctx.employee} is not clocked in and has a scheduled shift today.`;
        if (/^(HOM|SCH|DSH)$/.test(code)) return `Time Clock is online at site ${site}.`;
        return devicePre;
    };
    const webPre = `The manager is logged in to the manager web at site ${site}.`;

    const pickModule = (sec, text, fallback) => {
        if (/report/i.test(sec.title)) return "RPT";
        let best = null, bestScore = 0;
        for (let code of codes) {
            const sc = scoreModule(code, sec.title) * 3 + scoreModule(code, text);
            if (sc > bestScore) { best = code; bestScore = sc; }
        }
        return best || fallback || codes[0] || "EDG";
    };

    const settingsPath = (/(Manage Account\s*>\s*[^.\n(]+)/.exec(all) || [])[1];
    const savedToast = (/(?:observed\s+)?toast:?\s*(".+?")/i.exec(all) || [])[1];

    // "Review the toast" / "Review the screen" for an expected result that follows no action
    const reviewOf = expected => {
        const subject = (/^(?:To confirm:\s*)?(.+?)\s+should\b/.exec(expected) || [])[1] || "";
        if (!subject || /^["“]|^(a|an|when|if|it|this)\b/i.test(subject) || subject.split(" ").length > 6) return "Review the screen";
        if (VERBS.has(firstWord(subject))) return "Open " + subject;            // "Review Actions" is a panel name
        return "Review " + descStart(subject);
    };
    // "The NOTE step should show the configured note." → "the NOTE step shows the configured note"
    const shouldToPresent = expected => {
        const e = expected.replace(/^To confirm:\s*/, "").replace(/\.$/, "");
        const m = /^(.+?)\s+should\s+(not\s+)?(\w+)(.*)$/.exec(e);
        if (!m) return e;
        const [, subject, not, verb, rest] = m;
        const plural = /\band\b/.test(subject) || /s$/.test(subject.split(" ").pop()) && !/(ss|us|is)$/.test(subject);
        const present = verb === "be" ? (plural ? "are" : "is")
            : not ? `do${plural ? "" : "es"} not ${verb}`
            : plural ? verb : verb === "have" ? "has" : /(ch|sh|s|x|z|o)$/.test(verb) ? verb + "es" : /[^aeiou]y$/.test(verb) ? verb.slice(0, -1) + "ies" : verb + "s";
        return `${subject} ${not && verb === "be" ? present + " not" : present}${rest}`;
    };
    const META = /^(short code|source|version|author|date|prepared by|owner|status)\b/i;

    for (let sec of sections) {
        if (/test data|open question|questions|to confirm|summary|impacted|overview|navigation$|^introduction/i.test(sec.title)) continue;
        const text = sec.lines.filter(l => !META.test(cleanLine(l))).join("\n");
        if (!text.trim()) continue;
        // Manager web or settings screens vs the Time Clock device
        const isWeb = /dashboard|manager|report|\bweb\b|setting|setup|configuration|tile|my punches \(web\)/i.test(sec.title)
            || (/\bclick\b/i.test(text) && !/\btap\b/i.test(text));
        const pre = isWeb ? webPre : preFor(pickModule(sec, text), sec.title + " " + text.slice(0, 400));

        // ---- Regression notes → REG
        if (/regression/i.test(sec.title)) {
            for (let sent of sentences(sec.lines.map(cleanLine).join(" "))) {
                push("REG", [
                    `Verify ${descStart(stripEnd(sent).replace(/\bmust\b/i, "still"))}. [High]${employeeRef}`,
                    `Pre: ${devicePre}`,
                    `- Open the Daily Punch report for the same business date => To confirm: The punch times, roles and totals should match the screen.`,
                ]);
            }
            continue;
        }

        // ---- Settings / flags → CFG on and off
        const rows = /setting|flag|configuration|option/i.test(sec.title) || sec.lines.some(l => /\|\s*(effect|description)/i.test(l)) ? settingRows(sec.lines) : [];
        if (rows.length) {
            const code = has("CFG") ? "CFG" : pickModule(sec, text);
            const inTitle = (/\(([^)]*>[^)]*)\)/.exec(sec.title) || [])[1];
            const path = settingsPath ? stripEnd(settingsPath) + (inTitle && !settingsPath.includes(inTitle) ? " > " + inTitle.trim() : "") : (inTitle || "the settings screen");
            for (let { flag, effect } of rows) {
                const f = stripEnd(flag);
                let effectShould = null;
                const e = stripEnd(effect).replace(/\s*\([^)]*\)/g, "");
                const shows = /^(shows|displays)\s+(.+)$/i.exec(e);
                const makes = /^makes\s+(.+?)\s+available\b(.*)$/i.exec(e);
                const can = /^(employees|managers|users)\s+can\s+(.+)$/i.exec(e);
                if (shows) effectShould = `${capitalise(shows[2])} should be displayed.`;
                else if (makes) effectShould = `${capitalise(makes[1])} should be available${makes[2]}.`;
                else if (can) effectShould = `${capitalise(can[1])} should be able to ${can[2]}.`;
                else effectShould = toShould(e) || `To confirm: The change described as "${shorten(e, 70)}" should be visible.`;
                const saved = savedToast ? `${savedToast} should be displayed.` : "To confirm: A saved message should be displayed.";
                push(code, [
                    `Verify turning on ${f} applies its effect. [High]`,
                    `Pre: ${webPre}`,
                    `- Open ${path} => ${path.split(">").pop().trim()} should be displayed.`,
                    `- Turn on ${f} and tap Save => ${saved}`,
                    `- Open the affected screen => ${effectShould}`,
                ]);
                push(code, [
                    `Verify turning off ${f} removes its effect. [Medium]`,
                    `Pre: ${webPre} ${f} is on.`,
                    `- Turn off ${f} and tap Save => ${saved}`,
                    `- Open the affected screen => To confirm: The behaviour enabled by ${f} should no longer be available.`,
                ]);
            }
            continue;
        }

        // ---- Reports → RPT (date range, filters, search, exports, columns)
        if (/report/i.test(sec.title) && (/filter|export|column|date range|search/i.test(text))) {
            const reportName = (/([A-Z][\w ]+? Report)\b/.exec(sec.title + " " + text) || [])[1] || stripEnd(sec.title);
            const open = `- Open Reports > ${reportName} => ${reportName} should be displayed.`;
            const rpre = `Pre: ${webPre} Records exist for 10/20/2026.`;
            const cols = /columns?:\s*([^.\n]+)/i.exec(text);
            if (cols) push("RPT", [`Verify ${reportName} shows the expected columns. [High]`, rpre, open, `- Review the column headers => The columns ${stripEnd(cols[1])} should be displayed.`]);
            if (/date range/i.test(text)) push("RPT", [`Verify ${reportName} filters by date range. [High]`, rpre, open, `- Select the date range 10/20/2026 – 10/20/2026 => To confirm: Only records for 10/20/2026 should be listed.`]);
            // Filter lists: "Status: All, Acknowledged, Reported" or "Attestation Response (All / Yes / No)"
            const filters = [];
            for (let m of text.matchAll(/([A-Z][\w ]{2,40}?)\s*\(([^)]*\/[^)]*)\)/g)) filters.push([m[1].trim(), m[2].split("/").map(v => v.trim())]);
            for (let m of text.matchAll(/filter\s*>\s*([\w ]+):\s*([^.\n]+)/gi)) filters.push([m[1].trim(), m[2].replace(/,?\s*with clear and apply/i, "").split(/,\s*/).map(v => v.trim())]);
            for (let [name, values] of filters) {
                for (let v of values.filter(Boolean).slice(0, 8)) {
                    push("RPT", [
                        `Verify the ${name} filter with ${v}. [${/^all$/i.test(v) ? "Low" : "Medium"}]`, rpre, open,
                        `- Open Filter, select ${v} under ${name} and tap Apply => ${/^all$/i.test(v) ? "All records should be listed." : `To confirm: Only records with ${name} ${v} should be listed.`}`,
                    ]);
                }
            }
            if (/clear/i.test(text) && filters.length) push("RPT", [`Verify Clear resets the filters. [Low]`, rpre, open, `- Apply a filter, then tap Clear => To confirm: All records should be listed.`]);
            if (/search/i.test(text)) push("RPT", [`Verify ${reportName} search by keyword. [Medium]`, rpre, open, `- Enter ${ctx.employee || "Andrew"} in Search keyword => To confirm: Only ${ctx.employee || "Andrew"}'s records should be listed.`]);
            const exports = [...new Set([...text.matchAll(/(Export (?:PDF|CSV|Excel)|(?:PDF|CSV|Excel) Export)/gi)].map(m => m[1]))];
            for (let ex of exports) {
                const kind = /pdf/i.test(ex) ? "PDF" : /csv/i.test(ex) ? "CSV" : "Excel";
                push("RPT", [`Verify ${ex} downloads the report. [Medium]`, rpre, open,
                    `- Select the print icon, then ${ex} => A ${kind} file should be downloaded.`,
                    `- Open the file => To confirm: The file should list the same rows as the report.`]);
            }
            continue;
        }

        const sectionCode = pickModule(sec, text);
        const flowName = stripEnd(sec.title.replace(/^(flow|scenario)\s+[A-Z0-9]+\s*[:\-–—]\s*/i, "")) || "the flow";
        const disabledCase = (code, dis, extraPre) => push(code, [
            `Verify ${stripEnd(dis[1])} ${/ and |,/.test(dis[1]) ? "are" : "is"} disabled until ${stripEnd(dis[2])}. [High]${employeeRef}`,
            `Pre: ${pre}${extraPre}`,
            `- Review ${stripEnd(dis[1])} => ${capitalise(stripEnd(dis[1]))} should be disabled.`,
            `- ${conditionToAction(stripEnd(dis[2]))} => ${capitalise(stripEnd(dis[1]))} should be enabled.`,
        ]);
        const DISABLED = /^(.+?)\s+(?:is|are|stays|stay|remains?)\s+disabled until\s+(.+?)\.?$/i;

        // ---- Numbered flows → one case per result; an action is paired with the result it leads to
        const steps = numberedSteps(sec.lines);
        if (steps.length) {
            let carried = [];                                    // actions from the end of the previous step
            let lastCase = null;
            steps.forEach((step, k) => {
                // Each step goes to the module it is about (NOTE step → NOT, ATTESTATION step → ATT …)
                let code = sectionCode, best = 0;
                for (let c of codes) {
                    const sc = scoreModule(c, step.text);
                    if (sc > best && c !== "CFG") { best = sc; code = c; }
                }
                const lines = [];
                let pending = carried;
                carried = [];
                const expectations = [];
                // A result belongs to the last action before it; earlier waiting actions get their own step
                const pair = () => {
                    while (expectations.length) {
                        const expected = expectations.shift();
                        if (pending.length) {
                            const a = pending.pop();
                            pending.forEach(p => lines.push(`- ${p} => ${genericResult(p)}`));
                            pending = [];
                            lines.push(`- ${a} => ${expected}`);
                        } else {
                            lines.push(`- ${reviewOf(expected)} => ${expected}`);
                        }
                    }
                };
                for (let rawSent of sentences(concrete(step.text, ctx))) {
                    const { label, rest } = splitLabel(rawSent);
                    const actions = actionsFrom(rest);
                    if (actions.length) {
                        // "ACKNOWLEDGEMENT step: Acknowledge …" — reaching the step is the result of the previous action
                        if (label && /\b(step|pop-?up|screen|tab|page|dialog)\b/i.test(label)) { expectations.push(`The ${label} should be displayed.`); pair(); }
                        actions.forEach(a => { pending.push(a); const b = /^Tap (.+?)(?: on| under| in| for| to|$)/.exec(a); if (b) actionNames.add(b[1].trim()); });
                        continue;
                    }
                    const dis = DISABLED.exec(stripEnd(rest.replace(/^observed:?\s*/i, "")));
                    if (dis) { disabledCase(code, dis, ` ${flowName}: step ${step.n} is reached.`); continue; }
                    // Clause by clause: "Select punches, then Report", "Or Confirm, and the Status shows …"
                    splitObservations(rest).forEach((clause, i) => {
                        // A clause about a button doing something is really an action and its result
                        const ctl = controlAction(clause);
                        if (ctl) {
                            pending.forEach(p => lines.push(`- ${p} => ${genericResult(p)}`));
                            pending = [ctl.action];
                            expectations.push(ctl.expected);
                            pair();
                            return;
                        }
                        const acts = actionsFrom(clause);
                        if (acts.length) {
                            acts.forEach(a => { pending.push(a); const b = /^Tap (.+?)(?: on| under| in| for| to|$)/.exec(a); if (b) actionNames.add(b[1].trim()); });
                            return;
                        }
                        const expected = toShould(i === 0 && label ? `${label}: ${clause}` : clause);
                        if (expected) { expectations.push(expected); pair(); }
                    });
                }
                // The step's last actions lead to the next step's result — unless the next step starts with its own action
                const next = steps[k + 1];
                const nextFirst = next ? splitLabel(sentences(concrete(next.text, ctx))[0] || "").rest : "";
                if (!next || actionsFrom(nextFirst).length || controlAction(nextFirst)) {
                    pending.forEach(p => lines.push(`- ${p} => ${/^tap\b/i.test(p) && !next ? "To confirm: The flow should complete." : genericResult(p)}`));
                    pending = [];
                }
                carried = pending;
                if (!lines.length) return;
                // Describe the case by its first real result, not a generic "next screen"
                const results = lines.map(l => l.split(" => ")[1] || "");
                const real = results.find(e => e && !/^To confirm:/.test(e)) || results.find(e => e && !/The next screen should be displayed|The flow should complete/.test(e));
                const what = real ? shouldToPresent(real.replace(/^To confirm:\s*/, "")) : gerund(lines[lines.length - 1].slice(2).split(" => ")[0]);
                const important = k <= 1 || /save|submit|sign|clock|confirm|report|acknowledge|resolve/i.test(step.text);
                lastCase = [
                    `Verify ${shorten(descStart(what), 110)} [${important ? "High" : "Medium"}]${employeeRef}`.replace(/(\S)\s\[/, "$1. ["),
                    `Pre: ${pre}${k === 1 ? ` ${flowName}: step 1 is complete.` : k > 1 ? ` ${flowName}: steps 1–${k} are complete.` : ""}`,
                    ...lines,
                ];
                push(code, lastCase);
            });
            // Actions left at the very end of the flow
            if (carried.length && lastCase) {
                const code = sectionCode;
                push(code, [
                    `Verify ${gerund(carried[0]).replace(/^./, c => c.toLowerCase())} completes ${descStart(flowName)}. [Medium]${employeeRef}`,
                    `Pre: ${pre} ${flowName}: all earlier steps are complete.`,
                    ...carried.map(a => `- ${a} => ${/^tap\b/i.test(a) ? "To confirm: The flow should complete." : genericResult(a)}`),
                ]);
            }
            continue;
        }

        // ---- Plain statements (screen descriptions) → cases of up to four checks
        const code = sectionCode;
        // Each line on its own (labels like "Clock Out:" or "Right, top:" stay whole)
        const stmts = sec.lines.filter(l => l.trim() && !META.test(cleanLine(l))).flatMap(l => sentences(
            concrete(cleanLine(l.replace(/^\s*[-*•]\s*/, "")), ctx)
                // "it shows "Select Job Code" and is disabled until …" → two facts
                .replace(/\b(it|this|they)\s+(shows|displays|reads)\s+(".*?")\s+and\s+(is|are)\s+/gi,
                    (m, w, v, q, be) => `${w} ${v} ${q}. ${w.charAt(0).toUpperCase() + w.slice(1)} ${be} `)));
        let lastSubject = "";
        const checks = [];
        for (let raw of stmts) {
            // "it …" refers to the element described just before ("Bottom: the Clock In button. It shows …")
            const sent = lastSubject ? raw.replace(/^(observed:?\s*)?(it|this)\b/i, (m, obs) => (obs || "") + lastSubject) : raw;
            const np = splitLabel(stripEnd(sent)).rest;
            if (/^(the|a|an)\s+[\w ()·-]{2,40}$/i.test(np) && !/\b(is|are|shows|opens)\b/i.test(np)) lastSubject = np.replace(/^(a|an)\s/i, "the ");
            if (actionsFrom(splitLabel(sent).rest).length) continue;
            const dis = DISABLED.exec(stripEnd(sent.replace(/^observed:?\s*/i, "")));
            if (dis) { disabledCase(code, dis, ""); continue; }
            for (let piece of splitObservations(sent)) {
                const expected = toShould(piece);
                if (expected && !/^To confirm/.test(expected)) checks.push(expected);
            }
        }
        if (checks.length) {
            const chunks = [];
            for (let i = 0; i < checks.length; i += 4) chunks.push(checks.slice(i, i + 4));
            chunks.forEach((chunk, i) => push(code, [
                `${chunk.length === 1 ? verifyFromExpected(chunk[0]).replace(/\.$/, "") : `Verify ${/^[A-Z][a-z]+\s+[A-Z]|^[A-Z][a-z]+\s+(?:step|screen|tab|page|pop-?up|menu|dialog|report|card)\b/.test(flowName) ? "the " + flowName : descStart(flowName)}${chunks.length > 1 ? ` (part ${i + 1})` : ""} shows its ${chunk.length} expected elements`}. [${i === 0 ? "High" : "Medium"}]${employeeRef}`,
                `Pre: ${pre}`,
                `- Open ${flowName} => ${chunk[0]}`,
                ...chunk.slice(1).map(c => `- ${reviewOf(c)} => ${c}`),
            ]));
        }
    }

    // ---- English / Spanish
    if (/spanish|español|\bES\b|en\/es/i.test(all)) {
        const code = has("LNG") ? "LNG" : "EDG";
        const spanish = [...all.matchAll(/"([^"\n]{2,80})"/g)].map(m => m[1]).filter(t => /[áéíóúñ¿¡]/i.test(t)).slice(0, 3);
        push(code, [
            `Verify the clock screens switch to Spanish. [High]${employeeRef}`,
            `Pre: ${devicePre}`,
            `- Select ES on the EN/ES toggle => The clock screens should be displayed in Spanish.`,
            ...spanish.map(t => `- Review the Spanish text => "${t}" should be displayed.`),
        ]);
        push(code, [
            `Verify English is shown when a Spanish translation is missing. [Medium]${employeeRef}`,
            `Pre: ${devicePre} The ES text of one item is empty.`,
            `- Select ES on the EN/ES toggle => To confirm: The English text should be displayed for the item without a translation.`,
        ]);
        push(code, [
            `Verify longer Spanish text fits on the screens. [Low]${employeeRef}`,
            `Pre: ${devicePre}`,
            `- Select ES and review each step => The Spanish text should wrap without overflowing.`,
        ]);
    }

    // Buttons that save something → double-tap and network-loss cases (EDG) through the generator
    const saveLike = [...actionNames].filter(n => /^(save|submit|confirm|report|acknowledge|accept|clock out|continue|resolve|proceed)/i.test(n)).slice(0, 6);
    const firstCode = codes[0] || "EDG";

    const scenarios = {};
    for (let code of Object.keys(out)) scenarios[code] = out[code].join("\n").trim();
    return {
        scenarios,
        reports: tail.RPT.join("\n").trim(),
        regression: tail.REG.join("\n").trim(),
        edge: tail.EDG.join("\n").trim(),
        dataItems,
        actions: saveLike.map(n => `${n} | ${firstCode} | |`).join("\n"),
        docs: docs.length,
    };
}

// Write the scenarios into Setup (so they can be reviewed and edited), then generate the suite
function generateFromSources() {
    const docs = collectDocuments();
    if (!docs.length) {
        App.toast("No readable text in the sources. Upload release notes, a spec, slides or a PDF with text — screenshots alone need smart reading.");
        return false;
    }
    if (setupProblems().length) fillSetupOffline();
    const r = buildScenarios();
    const s = App.state;
    if (!s.project.basePre.trim()) {
        const site = (s.data.find(d => d.item === "Site") || {}).value || "Altametrics";
        s.project.basePre = `Time Clock is online at site ${site}.`;
    }
    let count = 0;
    for (let m of s.modules) {
        const text = r.scenarios[m.code.toUpperCase()];
        if (text) { m.scenarios = text; count += parseScenarios(text).length; }
    }
    // Scenarios for modules found in the notes but not in Setup go to the first module
    for (let [code, text] of Object.entries(r.scenarios)) {
        if (!s.modules.some(m => m.code.toUpperCase() === code) && s.modules[0]) {
            s.modules[0].scenarios = (s.modules[0].scenarios + "\n" + text).trim();
            count += parseScenarios(text).length;
        }
    }
    s.reports = r.reports;
    s.regression = r.regression;
    s.edgeScenarios = r.edge;
    if (r.actions && !s.actions.trim()) s.actions = r.actions;
    for (let d of r.dataItems) {
        const existing = s.data.find(x => x.item.toLowerCase() === d.item.toLowerCase());
        if (existing) Object.assign(existing, d); else s.data.push(d);
    }
    count += parseScenarios(r.reports).length + parseScenarios(r.regression).length + parseScenarios(r.edge).length;
    App.save();
    if (!count) {
        App.toast("The text didn't contain flows, settings or report details to turn into cases. Try Smart write, or add numbered steps to the test basis.");
        return false;
    }
    return true;
}