// Excel export in the team format: Dashboard (with pie chart) · Sheet1 (test cases) · Test Data.
// Writes the .xlsx (Office Open XML in an uncompressed zip) directly — no library needed.

// ---------- Minimal zip writer (STORE) ----------

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipFiles(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (let file of files) {
        const name = encoder.encode(file.name);
        const data = encoder.encode(file.content);
        const crc = crc32(data);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);          // UTF-8 names
        local.setUint16(8, 0, true);               // STORE
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        chunks.push(new Uint8Array(local.buffer), name, data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, data.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);

        offset += 30 + name.length + data.length;
    }

    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- Cell helpers ----------

function xmlEscape(value) {
    return String(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(index) {               // 0 → A
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
}

class Sheet {
    constructor() {
        this.rows = new Map();          // rowNumber → Map(col → xml)
        this.heights = {};
        this.merges = [];
    }
    set(ref, xml) {
        const [, col, row] = /^([A-Z]+)(\d+)$/.exec(ref);
        if (!this.rows.has(+row)) this.rows.set(+row, new Map());
        this.rows.get(+row).set(col, `<c r="${ref}"${xml}`);
    }
    text(ref, value, style) {
        if (value === "" || value === null || value === undefined) return this.blank(ref, style);
        this.set(ref, ` s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`);
    }
    num(ref, value, style) {
        this.set(ref, ` s="${style}"><v>${value}</v></c>`);
    }
    formula(ref, formula, cached, style) {
        this.set(ref, ` s="${style}"><f>${xmlEscape(formula)}</f>${cached === "" ? "" : `<v>${cached}</v>`}</c>`);
    }
    blank(ref, style) {
        this.set(ref, ` s="${style}"/>`);
    }
    sheetData() {
        const colOrder = c => c.length * 100 + c.charCodeAt(c.length - 1);
        // Rows with only a height (the spacer rows) still need a <row> element
        const rowNumbers = new Set([...this.rows.keys(), ...Object.keys(this.heights).map(Number)]);
        return [...rowNumbers].sort((a, b) => a - b).map(r => {
            const cells = [...(this.rows.get(r) || new Map()).entries()].sort((a, b) => colOrder(a[0]) - colOrder(b[0])).map(e => e[1]).join("");
            const ht = this.heights[r] ? ` ht="${this.heights[r]}" customHeight="1"` : "";
            return `<row r="${r}"${ht}>${cells}</row>`;
        }).join("");
    }
    xml({ cols, freezeRow = false, validations = "", drawing = false, tabSelected = false, fitHeight = null }) {
        const pane = freezeRow
            ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>`
            : "";
        // Print: landscape; fitHeight 1 = whole sheet on one page, 0 = one page wide
        const fit = fitHeight === null ? "" : '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
        const pageSetup = fitHeight === null ? "" : `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="${fitHeight}"/>`;
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${fit}
<sheetViews><sheetView workbookViewId="0"${tabSelected ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${this.sheetData()}</sheetData>
${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
${validations}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
${pageSetup}
${drawing ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
    }
}

// Rough wrapped-line count for Calibri 11 in a column of the given width
function lineCount(text, width) {
    const perLine = Math.max(1, Math.floor(width * 1.15));
    return String(text || "").split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0);
}

// ---------- Styles (cellXfs indexes) ----------

const S = {
    dashTitle: 1, dashLabel: 2, dashValue: 3, headLeft: 4, headCenter: 5,
    cellLeft: 6, cellCenter: 7, cellPct: 8, totalLeft: 9, totalCenter: 10, totalPct: 11, chartTitle: 12,
    tcHead: 13, section: 14, tcId: 15, tcText: 16,
    Pass: 17, Fail: 18, Blocked: 19, Untested: 20, link: 21, spacer: 22,
    dashFill: 23, input: 24, notesTitle: 25, notesText: 26,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="11">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F497D"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF00801A"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF7F6000"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0000FF"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF0000FF"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4F81BD"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF6A1B41"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="double"><color rgb="FF000000"/></bottom><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="27">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="9" fontId="2" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="5" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="8" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="9" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="10" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment horizontal="center" vertical="center"/><protection locked="0"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------- Sheets ----------

const TC_COLS = [15.6, 13.6, 44.1, 33.9, 34.7, 27.9, 37, 42.8, 13];
const DASH_COLS = [36, 14, 16, 14, 13, 13, 13, 4, 16, 12];

// Row height: tallest wrapped cell, minimum 42, in 0.75 pt steps
function rowHeight(points) {
    return Math.ceil(Math.max(42, points) / 0.75) * 0.75;
}

function buildTestCaseSheet(suite) {
    const sh = new Sheet();
    const headers = ["Test Case ID", "Importance", "Test Descriptions", "Preconditions", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status"];
    headers.forEach((h, i) => sh.text(colName(i) + "1", h, S.tcHead));
    sh.heights[1] = 26;

    let r = 2;
    const statusRefs = [];
    const importanceRefs = [];

    for (let section of suite.sections) {
        for (let i = 0; i < 9; i++) sh.text(colName(i) + r, i === 0 ? `${section.code} — ${section.title}` : "", S.section);
        sh.merges.push(`A${r}:I${r}`);
        sh.heights[r] = 21.75;
        r++;

        for (let c of section.cases) {
            const first = r;
            const steps = c.steps.length ? c.steps : [{ action: "", expected: "", actual: "", status: "Pass" }];
            const raw = {};

            steps.forEach((step, si) => {
                const row = first + si;
                if (si === 0) {
                    sh.text(`A${row}`, c.id, S.tcId);
                    sh.text(`B${row}`, c.importance, S.tcText);
                    sh.text(`C${row}`, c.description, S.tcText);
                    sh.text(`D${row}`, c.pre, S.tcText);
                    sh.text(`F${row}`, c.data, S.tcText);
                } else {
                    ["A", "B", "C", "D", "F"].forEach(col => sh.blank(col + row, col === "A" ? S.tcId : S.tcText));
                }
                sh.text(`E${row}`, step.action, S.tcText);
                sh.text(`G${row}`, step.expected, S.tcText);
                sh.text(`H${row}`, step.actual, S.tcText);
                sh.text(`I${row}`, step.status || "Pass", S[step.status] || S.Pass);
                statusRefs.push(`I${row}`);
                raw[row] = 15 * Math.max(1, ...[[step.action, 4], [step.expected, 6], [step.actual, 7]].map(([t, col]) => lineCount(t, TC_COLS[col])));
            });

            const last = first + steps.length - 1;
            importanceRefs.push(`B${first}`);
            if (last > first) ["A", "B", "C", "D", "F"].forEach(col => sh.merges.push(`${col}${first}:${col}${last}`));

            // The merged cells (description, preconditions, test data) share the case's rows
            const need = 15 * Math.max(...[[c.description, 2], [c.pre, 3], [c.data, 5]].map(([t, col]) => lineCount(t, TC_COLS[col])));
            let have = 0;
            for (let row = first; row <= last; row++) have += Math.max(42, raw[row]);
            const extra = have < need ? (need - have) / steps.length : 0;
            for (let row = first; row <= last; row++) sh.heights[row] = rowHeight(raw[row] + extra + 3);

            r = last + 1;
            for (let i = 0; i < 9; i++) sh.blank(colName(i) + r, S.spacer);   // grey spacer row between every test case
            sh.heights[r] = 7.5;
            r++;
        }
    }

    const validations = statusRefs.length ? `<dataValidations count="2">
<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${statusRefs.join(" ")}"><formula1>"Pass,Fail,Blocked,Untested"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${importanceRefs.join(" ")}"><formula1>"High,Medium,Low"</formula1></dataValidation>
</dataValidations>` : "";

    return sh.xml({ cols: TC_COLS, freezeRow: true, validations, fitHeight: 0 });
}

function buildTestDataSheet(data, suite) {
    const sh = new Sheet();
    const widths = [6, 18, 30, 52, 52, 34];
    ["#", "Category", "Data Item", "Value", "Used By (Test Case IDs)", "Notes"].forEach((h, i) => sh.text(colName(i) + "1", h, S.tcHead));
    sh.heights[1] = 26;

    exportData(data, suite).forEach((d, i) => {
        const r = i + 2;
        sh.num(`A${r}`, i + 1, S.tcText);
        sh.text(`B${r}`, d.category, S.tcText);
        sh.text(`C${r}`, d.item, S.tcText);
        sh.text(`D${r}`, d.value, /^https?:\/\//.test(d.value) ? S.link : S.tcText);
        sh.text(`E${r}`, d.usedByText, S.tcText);
        sh.text(`F${r}`, d.notes, S.tcText);
        sh.heights[r] = Math.max(30, 15 * Math.max(...[[d.value, 3], [d.usedByText, 4], [d.notes, 5], [d.item, 2]].map(([t, c]) => lineCount(t, widths[c]))) + 6);
    });
    return sh.xml({ cols: widths, freezeRow: true, fitHeight: 0 });
}

function moduleStats(section) {
    const s = { total: section.cases.length, Pass: 0, Fail: 0, Blocked: 0 };
    for (let c of section.cases) {
        const st = caseStatus(c);
        if (st in s) s[st]++;
    }
    return s;
}

// "Clock-in screen & Job Code (CIN)"
function moduleLabel(section) {
    const name = (section.name || section.title || "").trim();
    return name.endsWith(`(${section.code})`) ? name : `${name} (${section.code})`;
}

// Notes under the chart: what is covered, what is excluded, which cases rest on an assumption
function dashboardNotes(project, suite, meta) {
    const covered = suite.sections.map(s => `${s.code} ${s.name || s.title}`).join("; ");
    const assumptions = suite.sections.flatMap(s => s.cases.filter(c => c.steps.some(x => /^to confirm:/i.test(x.expected || ""))).map(c => c.id));
    const excluded = (meta.excluded || []).length ? meta.excluded.join("; ") : "Nothing excluded.";
    const withOwn = suite.sections.flatMap(s => s.cases.filter(c => (c.evidence || "").trim()).map(c => `${c.id}: ${c.evidence.trim()}`));
    const evidence = [(project.evidence || "").trim(), ...withOwn].filter(Boolean).join("; ") || "None recorded — no case can show Pass.";
    return [
        ["Covered", `${meta.scopeLabel ? meta.scopeLabel + ". " : ""}${covered || "—"}`],
        ["Excluded", excluded],
        ["Evidence", evidence],
        ["Assumptions", assumptions.length ? `${assumptions.length} case${assumptions.length === 1 ? "" : "s"} rest on a "To confirm:" result: ${assumptions.join(", ")}` : "None — every expected result comes from the sources."],
    ];
}

function buildDashboardSheet(project, suite, meta = {}) {
    const sh = new Sheet();

    // Project Details A1:D5 — fill DCE6F1, navy accents
    sh.text("A1", "Project Details", S.dashTitle);
    ["B1", "C1", "D1"].forEach(ref => sh.blank(ref, S.dashTitle));
    sh.merges.push("A1:D1");
    const row = (r, label, value, label2, value2) => {
        sh.text(`A${r}`, label, S.dashTitle);
        if (label2 === undefined) {
            sh.text(`B${r}`, value || "", S.dashFill);
            sh.blank(`C${r}`, S.dashFill);
            sh.blank(`D${r}`, S.dashFill);
            sh.merges.push(`B${r}:D${r}`);
        } else {
            sh.text(`B${r}`, value || "", S.dashFill);
            sh.text(`C${r}`, label2, S.dashTitle);
            sh.text(`D${r}`, value2 || "", S.dashFill);
        }
    };
    row(2, "Project Name", project.name);
    row(3, "Environment", project.environment, "Platform", project.platform);
    row(4, "Tested By", project.testedBy, "Execution Date", project.executionDate);
    row(5, "Scope", meta.scopeLabel || "", "Suite ID", idPrefix(project, "MOD") + "_NNN");

    ["Module / Epic", "Total Cases", "Passed", "Failed", "Blocked", "Untested", "Pass Rate"]
        .forEach((h, i) => sh.text(colName(i) + "7", h, i === 0 ? S.headLeft : S.headCenter));
    sh.text("I7", "Status", S.headCenter);
    sh.text("J7", "Cases", S.headCenter);

    const sections = suite.sections;
    const totals = { total: 0, Pass: 0, Fail: 0, Blocked: 0 };
    sections.forEach((section, i) => {
        const r = 8 + i;
        const s = moduleStats(section);
        Object.keys(totals).forEach(k => { totals[k] += s[k]; });
        // Explicit counts (no COUNTIF). Passed, Failed and Blocked are the only cells anyone types into.
        sh.text(`A${r}`, moduleLabel(section), S.cellLeft);
        sh.num(`B${r}`, s.total, S.cellCenter);
        sh.num(`C${r}`, s.Pass, S.input);
        sh.num(`D${r}`, s.Fail, S.input);
        sh.num(`E${r}`, s.Blocked, S.input);
        sh.formula(`F${r}`, `B${r}-C${r}-D${r}-E${r}`, s.total - s.Pass - s.Fail - s.Blocked, S.cellCenter);
        sh.formula(`G${r}`, `IF(B${r}=0,"",C${r}/B${r})`, s.total ? s.Pass / s.total : "", S.cellPct);
    });

    const t = 8 + sections.length;          // TOTAL row
    const untested = totals.total - totals.Pass - totals.Fail - totals.Blocked;
    sh.text(`A${t}`, "TOTAL", S.totalLeft);
    [["B", totals.total], ["C", totals.Pass], ["D", totals.Fail], ["E", totals.Blocked], ["F", untested]]
        .forEach(([col, v]) => sh.formula(`${col}${t}`, `SUM(${col}8:${col}${Math.max(8, t - 1)})`, v, S.totalCenter));
    sh.formula(`G${t}`, `IF(B${t}=0,"",C${t}/B${t})`, totals.total ? totals.Pass / totals.total : "", S.totalPct);

    // Overall Test Execution Status card (I & J) — the chart's only source
    const statusRows = [["Passed", "C", totals.Pass], ["Failed", "D", totals.Fail], ["Blocked", "E", totals.Blocked], ["Untested", "F", untested]];
    statusRows.forEach(([label, col, v], i) => {
        sh.text(`I${8 + i}`, label, S.cellLeft);
        sh.formula(`J${8 + i}`, `${col}${t}`, v, S.cellCenter);
    });
    sh.text("I12", "Total", S.totalLeft);
    sh.formula("J12", "SUM(J8:J11)", totals.total, S.totalCenter);

    // Chart below the module table at A17 (lower when the table is longer); notes block below the chart
    const chartRow = Math.max(16, Math.max(t, 12) + 1);          // 0-based → A17, or one row below a longer table
    const notesRow = chartRow + 1 + 21;                           // ~10 cm of chart ≈ 20 rows
    sh.text(`A${notesRow}`, "Notes", S.notesTitle);
    dashboardNotes(project, suite, meta).forEach(([label, text], i) => {
        const r = notesRow + 1 + i;
        sh.text(`A${r}`, label, S.dashLabel);
        sh.text(`B${r}`, text, S.notesText);
        for (const col of ["C", "D", "E", "F", "G"]) sh.blank(`${col}${r}`, S.notesText);
        sh.merges.push(`B${r}:G${r}`);
        sh.heights[r] = Math.max(18, 15 * lineCount(text, DASH_COLS.slice(1, 7).reduce((a, b) => a + b, 0)) + 3);
    });

    return {
        xml: sh.xml({ cols: DASH_COLS, drawing: true, tabSelected: true, fitHeight: 1 }),
        chartRow,
        counts: statusRows.map(s => [s[0], s[2]]),
    };
}

function chartXml(counts) {
    const colors = ["4F81BD", "C0504D", "9BBB59", "8064A2"];   // Passed, Failed, Blocked, Untested
    const dPts = colors.map((c, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("");
    // Zero-value slices get no label, so empty statuses do not stack
    const hidden = counts.map((c, i) => (c[1] ? "" : `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>`)).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>Overall Test Execution Status</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:pieChart><c:varyColors val="1"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:tx><c:strRef><c:f>Dashboard!$J$7</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Cases</c:v></c:pt></c:strCache></c:strRef></c:tx>
${dPts}
<c:dLbls>${hidden}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator>; </c:separator><c:showLeaderLines val="1"/></c:dLbls>
<c:cat><c:strRef><c:f>Dashboard!$I$8:$I$11</c:f><c:strCache><c:ptCount val="4"/>${counts.map((c, i) => `<c:pt idx="${i}"><c:v>${c[0]}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>Dashboard!$J$8:$J$11</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/>${counts.map((c, i) => `<c:pt idx="${i}"><c:v>${c[1]}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val>
</c:ser>
<c:firstSliceAng val="0"/>
</c:pieChart>
</c:plotArea>
<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

// Chart anchored at column A of the given 0-based row, 16 × 10 cm
function drawingXml(row) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:ext cx="5760000" cy="3600000"/>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>
</xdr:wsDr>`;
}

// ---------- Workbook ----------
// Sheets: Dashboard · Sheet1 (test cases) · Test Data — the team format's names

function buildWorkbook(project, suite, data, meta = {}) {
    const dash = buildDashboardSheet(project, suite, meta);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    const RELS = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`;
    const CT = "application/vnd.openxmlformats-officedocument";

    return zipFiles([
        { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="${CT}.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT}.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${CT}.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet3.xml" ContentType="${CT}.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="${CT}.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="${CT}.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="${CT}.drawingml.chart+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/>
</Types>` },
        { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${RELS}>
${rel("rId1", "officeDocument", "xl/workbook.xml")}
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
${rel("rId3", "extended-properties", "docProps/app.xml")}
</Relationships>` },
        { name: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEscape(project.name)} Test Cases</dc:title><dc:creator>${xmlEscape(project.testedBy || "QA Team")}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>` },
        { name: "docProps/app.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Test Case Generator</Application></Properties>` },
        { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/><sheet name="Sheet1" sheetId="2" r:id="rId2"/><sheet name="Test Data" sheetId="3" r:id="rId3"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="1">Sheet1!$1:$1</definedName><definedName name="_xlnm.Print_Titles" localSheetId="2">'Test Data'!$1:$1</definedName></definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>` },
        { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${RELS}>
${rel("rId1", "worksheet", "worksheets/sheet1.xml")}
${rel("rId2", "worksheet", "worksheets/sheet2.xml")}
${rel("rId3", "worksheet", "worksheets/sheet3.xml")}
${rel("rId4", "styles", "styles.xml")}
</Relationships>` },
        { name: "xl/styles.xml", content: STYLES_XML },
        { name: "xl/worksheets/sheet1.xml", content: dash.xml },
        { name: "xl/worksheets/_rels/sheet1.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${RELS}>${rel("rId1", "drawing", "../drawings/drawing1.xml")}</Relationships>` },
        { name: "xl/worksheets/sheet2.xml", content: buildTestCaseSheet(suite) },
        { name: "xl/worksheets/sheet3.xml", content: buildTestDataSheet(data, suite) },
        { name: "xl/drawings/drawing1.xml", content: drawingXml(dash.chartRow) },
        { name: "xl/drawings/_rels/drawing1.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${RELS}>${rel("rId1", "chart", "../charts/chart1.xml")}</Relationships>` },
        { name: "xl/charts/chart1.xml", content: chartXml(dash.counts) },
    ]);
}
