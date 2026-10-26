// Import an existing test case workbook (.xlsx) into a suite, so it can be edited here or through chat.
// Reads the current standard (Dashboard / Test Case / Test Data) and the older
// "Name | Importance | Summary | Preconditions | Actions | Expected Result | Status" sheets.

async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This is not a valid zip-based file (.xlsx, .docx, .pptx, .zip …).");

    const entries = {};
    let p = view.getUint32(eocd + 16, true);
    for (let n = view.getUint16(eocd + 10, true); n > 0; n--) {
        const nameLen = view.getUint16(p + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
        entries[name] = { method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), offset: view.getUint32(p + 42, true) };
        p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    }

    // Raw (uncompressed) bytes of one entry
    async function bytesOf(name) {
        const e = entries[name];
        if (!e) return null;
        const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
        const data = bytes.subarray(start, start + e.size);
        if (e.method === 0) return data;
        if (e.method === 8) {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error("Unsupported compression in " + name);
    }

    // read(name) → text; read.bytes(name) → Uint8Array; read.names → every entry in the archive
    const read = async name => {
        const data = await bytesOf(name);
        return data === null ? null : new TextDecoder().decode(data);
    };
    read.bytes = bytesOf;
    read.names = Object.keys(entries);
    return read;
}

function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
}

function colIndex(ref) {
    const letters = /^[A-Z]+/.exec(ref)[0];
    let n = 0;
    for (let ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
}

async function readWorkbookSheets(buffer) {
    const read = await readZip(buffer);
    const shared = [];
    const ss = await read("xl/sharedStrings.xml");
    if (ss) {
        for (let si of Array.from(parseXml(ss).getElementsByTagName("si"))) {
            let text = "";
            for (let t of Array.from(si.getElementsByTagName("t"))) {
                if (t.parentNode.nodeName !== "rPh") text += t.textContent;
            }
            shared.push(text);
        }
    }

    const wb = parseXml(await read("xl/workbook.xml"));
    const rels = parseXml(await read("xl/_rels/workbook.xml.rels"));
    const targets = {};
    for (let r of Array.from(rels.getElementsByTagName("Relationship"))) targets[r.getAttribute("Id")] = r.getAttribute("Target");

    const sheets = [];
    for (let s of Array.from(wb.getElementsByTagName("sheet"))) {
        const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        let target = (targets[rid] || "").replace(/^\//, "");
        if (!target.startsWith("xl/")) target = "xl/" + target;
        const xml = await read(target);
        if (!xml) continue;

        const rows = [];
        for (let row of Array.from(parseXml(xml).getElementsByTagName("row"))) {
            const values = [];
            for (let c of Array.from(row.getElementsByTagName("c"))) {
                const type = c.getAttribute("t");
                const v = c.getElementsByTagName("v")[0];
                let text = "";
                if (type === "s" && v) text = shared[Number(v.textContent)] || "";
                else if (type === "inlineStr") text = Array.from(c.getElementsByTagName("t")).map(t => t.textContent).join("");
                else if (v) text = v.textContent;
                values[colIndex(c.getAttribute("r"))] = text.trim();
            }
            rows.push({ r: Number(row.getAttribute("r")), values });
        }
        sheets.push({ name: s.getAttribute("name"), rows });
    }
    return sheets;
}

const HEADER_KEYS = {
    id: ["test case id", "tc id", "test id", "id", "name", "scenario id"],
    importance: ["importance", "priority"],
    description: ["test descriptions", "test description", "summary", "description", "title", "scenario"],
    pre: ["preconditions", "precondition", "pre-conditions"],
    action: ["test steps", "test step", "steps", "actions", "action"],
    data: ["test data"],
    expected: ["expected result", "expected results", "expected"],
    actual: ["actual result", "actual results", "actual"],
    status: ["status"],
};

function mapHeader(values) {
    const map = {};
    (values || []).forEach((v, i) => {
        const key = (v || "").toLowerCase().trim();
        for (let [field, names] of Object.entries(HEADER_KEYS)) {
            if (map[field] === undefined && names.includes(key)) map[field] = i;
        }
    });
    return map.id !== undefined && (map.action !== undefined || map.expected !== undefined) ? map : null;
}

function normStatus(value) {
    const v = (value || "").toLowerCase();
    if (v.startsWith("pass")) return "Pass";
    if (v.startsWith("fail")) return "Fail";
    if (v.startsWith("block")) return "Blocked";
    return "Untested";
}

function normImportance(value) {
    const v = (value || "").toLowerCase();
    if (v.startsWith("crit") || v.startsWith("high")) return "High";
    if (v.startsWith("low")) return "Low";
    return "Medium";
}

function splitSectionTitle(text) {
    const m = /^([A-Z][A-Z0-9]{1,7})\s*[—–\-:]\s*(.+)$/.exec(text);
    return m ? { code: m[1], title: m[2].trim() } : { code: "", title: text };
}

function excelDate(value) {
    if (/^\d{5}(\.\d+)?$/.test(value)) {
        return new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000).toISOString().slice(0, 10);
    }
    return value;
}

async function importWorkbook(buffer) {
    const sheets = await readWorkbookSheets(buffer);
    const project = {};
    const data = [];
    const sections = [];
    const moduleNames = {};

    for (let sheet of sheets) {
        // Dashboard: project details + module names
        for (let row of sheet.rows) {
            const [a = "", b = "", c = "", d = ""] = row.values;
            // Project details come as label / value pairs in A:B and C:D
            for (const [labelText, value] of [[a, b], [c, d]]) {
                const label = (labelText || "").toLowerCase();
                if (label === "project name") project.name = value;
                else if (label === "test environment" || label === "environment") project.environment = value;
                else if (label === "platform") project.platform = value;
                else if (label === "tested by") project.testedBy = value;
                else if (label === "execution date") project.executionDate = excelDate(value);
                else if (label === "evidence" && value && !/^none recorded/i.test(value)) project.evidence = value.split("; ").filter(v => !/^[A-Z0-9]+(?:_[A-Z0-9]+)*_\d{3}:/.test(v)).join("; ");
            }
            const mod = /^(.*)\(([A-Z0-9]{2,8})\)\s*$/.exec(a);
            if (mod && /^\d+$/.test(b)) moduleNames[mod[2]] = mod[1].trim();
        }

        // Test Data
        const dataHeader = sheet.rows.findIndex(r => r.values.some(v => (v || "").toLowerCase() === "data item"));
        if (dataHeader >= 0) {
            const h = sheet.rows[dataHeader].values.map(v => (v || "").toLowerCase());
            const col = name => h.findIndex(v => v.startsWith(name));
            for (let row of sheet.rows.slice(dataHeader + 1)) {
                const v = row.values;
                const item = v[col("data item")];
                if (!item) continue;
                data.push({
                    category: v[col("category")] || "",
                    item,
                    value: v[col("value")] || "",
                    notes: col("notes") >= 0 ? v[col("notes")] || "" : "",
                });
            }
            continue;
        }

        // Test cases
        const headerIndex = sheet.rows.slice(0, 6).findIndex(r => mapHeader(r.values));
        if (headerIndex < 0) continue;
        const map = mapHeader(sheet.rows[headerIndex].values);
        const get = (row, field) => map[field] === undefined ? "" : (row.values[map[field]] || "");

        let section = null;
        let current = null;
        const ensureSection = () => {
            if (!section) {
                section = { code: "", name: sheet.name, title: sheet.name, cases: [] };
                sections.push(section);
            }
            return section;
        };

        for (let row of sheet.rows.slice(headerIndex + 1)) {
            const filled = row.values.filter(v => v);
            if (filled.length === 0) continue;

            const id = get(row, "id");
            const step = { action: get(row, "action"), expected: get(row, "expected"), actual: get(row, "actual"), status: normStatus(get(row, "status")) };
            const hasStep = step.action || step.expected || step.actual;

            // Section banner: a single value in the first column that isn't an ID (e.g. "HOM — Upcoming Shifts side menu")
            const first = row.values[0] || "";
            if (filled.length === 1 && first && /\s/.test(first) && !hasStep) {
                const t = splitSectionTitle(first);
                section = { code: t.code, name: t.title, title: t.title, cases: [] };
                sections.push(section);
                current = null;
                continue;
            }

            if (id) {
                current = {
                    id,
                    importance: normImportance(get(row, "importance")),
                    description: get(row, "description"),
                    pre: get(row, "pre"),
                    data: get(row, "data") || (map.data === undefined ? "" : NO_DATA),
                    steps: [],
                };
                ensureSection().cases.push(current);
            } else if (current) {
                const morePre = get(row, "pre");
                if (morePre) current.pre += (current.pre ? "\n" : "") + morePre;
            }
            if (current && hasStep) current.steps.push(step);
        }
    }

    const all = sections.flatMap(s => s.cases);
    if (all.length === 0) throw new Error("No test cases found. The sheet needs a header row with Test Case ID (or Name) and Test Steps / Expected Result.");

    // Project code and infix from the IDs, e.g. UPS_CR_HOM_001 → UPS + CR
    const parts = all[0].id.split("_");
    if (parts.length >= 4) {
        project.code = parts[0];
        project.infix = parts.slice(1, -2).join("_");
    } else if (parts.length === 3) {
        project.code = parts[0];
        project.infix = "";
    }

    sections.forEach((s, i) => {
        if (!s.code) {
            const idParts = s.cases[0] ? s.cases[0].id.split("_") : [];
            const words = s.name.split(/[^A-Za-z0-9]+/).filter(Boolean);
            s.code = idParts.length >= 3 ? idParts[idParts.length - 2].toUpperCase()
                : words.length > 1 ? words.map(w => w[0]).join("").toUpperCase().slice(0, 4)
                : (words[0] || "S" + (i + 1)).slice(0, 3).toUpperCase();
        }
        s.name = moduleNames[s.code] || s.name;
        s.cases.forEach(c => { if (c.steps.length === 0) c.steps.push({ action: "", expected: "", actual: "", status: "Untested" }); });
    });

    return { project, suite: { sections: sections.filter(s => s.cases.length) }, data };
}
