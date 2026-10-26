// Workbook tab: the exported .xlsx rendered like Excel — Dashboard, Test Case and Test Data sheets
// with column letters, row numbers, gridlines, merged cells and the pie chart. Text cells are editable.

const PX = 7.2;                        // Excel column-width unit → pixels
const DATA_COLS = [6, 18, 30, 52, 52, 34];
let currentSheet = "cases";

function xlColgroup(widths) {
    return `<colgroup><col class="xl-rn">${widths.map(w => `<col style="width:${Math.round(w * PX)}px">`).join("")}</colgroup>`;
}

function xlLetters(widths) {
    return `<thead><tr><th class="xl-corner"></th>${widths.map((_, i) => `<th>${colName(i)}</th>`).join("")}</tr></thead>`;
}

function xlEdit(path, value, ref, extra = "") {
    return `<div class="xl-ce" contenteditable="true" spellcheck="true" data-bind="${path}" data-ref="${ref}" ${extra}>${escapeHtml(value)}</div>`;
}

function xlText(value, ref) {
    return `<div class="xl-ce" tabindex="0" data-ref="${ref}" data-readonly>${escapeHtml(value)}</div>`;
}

function xlSelect(path, value, options, ref, cls) {
    return `<select class="xl-select ${cls}" data-bind="${path}" data-ref="${ref}">${options.map(o => `<option ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select>`;
}

// ---------- Test Case sheet ----------

function renderCaseSheet() {
    const sections = App.state.suite.sections;
    const headers = ["Test Case ID", "Importance", "Test Descriptions", "Preconditions", "Test Steps", "Test Data", "Expected Result", "Actual Result", "Status"];
    let r = 1;
    const rows = [`<tr class="xl-h1"><th class="xl-rn">1</th>${headers.map((h, i) => `<td class="xl-head" data-ref="${colName(i)}1">${h}</td>`).join("")}</tr>`];
    r = 2;

    sections.forEach((section, si) => {
        rows.push(`<tr class="xl-banner-row"><th class="xl-rn">${r}</th><td colspan="9" class="xl-banner" data-ref="A${r}">${escapeHtml(section.code)} — ${xlEdit(`suite.sections.${si}.title`, section.title, `A${r}`, "data-single")}</td></tr>`);
        r++;
        section.cases.forEach((c, ci) => {
            const base = `suite.sections.${si}.cases.${ci}`;
            const steps = c.steps.length ? c.steps : [{ action: "", expected: "", actual: "", status: "Untested" }];
            const span = steps.length;
            steps.forEach((s, k) => {
                const row = r + k;
                const merged = k === 0 ? `
                    <td rowspan="${span}" class="xl-id">${xlText(c.id, `A${row}`)}</td>
                    <td rowspan="${span}">${xlSelect(`${base}.importance`, c.importance, IMPORTANCE, `B${row}`, "imp-" + c.importance.toLowerCase())}</td>
                    <td rowspan="${span}">${xlEdit(`${base}.description`, c.description, `C${row}`)}</td>
                    <td rowspan="${span}">${xlEdit(`${base}.pre`, c.pre, `D${row}`)}</td>` : "";
                const data = k === 0 ? `<td rowspan="${span}">${xlEdit(`${base}.data`, c.data, `F${row}`)}</td>` : "";
                rows.push(`<tr class="xl-step"><th class="xl-rn">${row}</th>${merged}
                    <td>${xlEdit(`${base}.steps.${k}.action`, s.action, `E${row}`)}</td>${data}
                    <td>${xlEdit(`${base}.steps.${k}.expected`, s.expected, `G${row}`)}</td>
                    <td>${xlEdit(`${base}.steps.${k}.actual`, s.actual, `H${row}`)}</td>
                    <td class="xl-status-cell">${xlSelect(`${base}.steps.${k}.status`, s.status, STATUSES, `I${row}`, "xs-" + (s.status || "Untested").toLowerCase())}</td></tr>`);
            });
            r += span;
            rows.push(`<tr class="xl-spacer"><th class="xl-rn">${r}</th><td colspan="9"></td></tr>`);
            r++;
        });
    });
    for (let i = 0; i < 6; i++, r++) rows.push(`<tr class="xl-empty"><th class="xl-rn">${r}</th>${"<td></td>".repeat(9)}</tr>`);

    return `<table class="xl-table xl-cases">${xlColgroup(TC_COLS)}${xlLetters(TC_COLS)}<tbody>${rows.join("")}</tbody></table>`;
}

// ---------- Dashboard sheet ----------

function renderDashSheet() {
    const p = App.state.project;
    const sections = App.state.suite.sections;
    const meta = workbookMeta(App.state);
    const cell = (content, cls = "", ref = "", attrs = "") => `<td class="${cls}" ${ref ? `data-ref="${ref}"` : ""} ${attrs}>${content}</td>`;
    const empty = n => "<td></td>".repeat(n);
    const rows = [];
    const row = (n, html, cls = "") => rows.push(`<tr class="${cls}"><th class="xl-rn">${n}</th>${html}</tr>`);
    const edit = (key, n, col) => xlEdit(`project.${key}`, p[key] || "", `${col}${n}`, "data-single");

    // Project Details A1:D5 — fill DCE6F1, navy accents
    row(1, cell("Project Details", "xd-title", "A1", 'colspan="4"') + empty(6));
    row(2, cell("Project Name", "xd-title", "A2") + cell(edit("name", 2, "B"), "xd-fill", "", 'colspan="3"') + empty(6));
    row(3, cell("Environment", "xd-title", "A3") + cell(edit("environment", 3, "B"), "xd-fill") + cell("Platform", "xd-title", "C3") + cell(edit("platform", 3, "D"), "xd-fill") + empty(6));
    row(4, cell("Tested By", "xd-title", "A4") + cell(edit("testedBy", 4, "B"), "xd-fill") + cell("Execution Date", "xd-title", "C4") + cell(edit("executionDate", 4, "D"), "xd-fill") + empty(6));
    row(5, cell("Scope", "xd-title", "A5") + cell(escapeHtml(meta.scopeLabel), "xd-fill", "B5") + cell("Suite ID", "xd-title", "C5") + cell(escapeHtml(idPrefix(p, "MOD") + "_NNN"), "xd-fill", "D5") + empty(6));
    row(6, empty(10));
    row(7, ["Module / Epic", "Total Cases", "Passed", "Failed", "Blocked", "Untested", "Pass Rate"].map((h, i) => cell(h, "xd-head" + (i ? " c" : ""), `${colName(i)}7`)).join("") +
        "<td></td>" + cell("Status", "xd-head c", "I7") + cell("Cases", "xd-head c", "J7"));

    const totals = { total: 0, Pass: 0, Fail: 0, Blocked: 0 };
    const statusRows = [];
    sections.forEach(section => {
        const s = moduleStats(section);
        Object.keys(totals).forEach(k => { totals[k] += s[k]; });
        statusRows.push([moduleLabel(section), s]);
    });
    const untested = totals.total - totals.Pass - totals.Fail - totals.Blocked;
    const card = [["Passed", totals.Pass], ["Failed", totals.Fail], ["Blocked", totals.Blocked], ["Untested", untested], ["Total", totals.total]];
    const t = 8 + sections.length;
    const last = Math.max(t, 12);
    const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "";

    for (let n = 8; n <= last; n++) {
        let html;
        const i = n - 8;
        if (i < sections.length) {
            const [label, s] = statusRows[i];
            const un = s.total - s.Pass - s.Fail - s.Blocked;
            // Passed, Failed and Blocked are the input cells (amber, blue)
            html = cell(escapeHtml(label), "xd-cell", `A${n}`) + [s.total, s.Pass, s.Fail, s.Blocked, un, pct(s.Pass, s.total)]
                .map((v, k) => cell(v, (k >= 1 && k <= 3 ? "xd-input" : "xd-cell") + " c", `${colName(k + 1)}${n}`)).join("");
        } else if (n === t) {
            html = cell("TOTAL", "xd-total", `A${n}`) + [totals.total, totals.Pass, totals.Fail, totals.Blocked, untested, pct(totals.Pass, totals.total)].map((v, k) => cell(v, "xd-total c", `${colName(k + 1)}${n}`)).join("");
        } else {
            html = empty(7);
        }
        html += "<td></td>";
        const b = card[n - 8];
        html += b ? cell(b[0], n === 12 ? "xd-total" : "xd-cell", `I${n}`) + cell(b[1], (n === 12 ? "xd-total" : "xd-cell") + " c", `J${n}`) : empty(2);
        row(n, html);
    }

    // Chart below the module table at A17 (lower when the table is longer), then the notes block
    const chartStart = Math.max(17, last + 2);
    for (let n = last + 1; n < chartStart; n++) row(n, empty(10));
    const parts = [["Passed", totals.Pass, "#4F81BD"], ["Failed", totals.Fail, "#C0504D"], ["Blocked", totals.Blocked, "#9BBB59"], ["Untested", untested, "#8064A2"]];
    row(chartStart, `<td colspan="6" rowspan="16" class="xd-chart"><div class="xd-chart-title">Overall Test Execution Status</div>${xlPie(parts, totals.total)}</td>` + empty(4));
    for (let n = chartStart + 1; n < chartStart + 16; n++) row(n, empty(4));
    const notesRow = chartStart + 17;
    row(notesRow, cell("Notes", "xd-notes-title", `A${notesRow}`) + empty(9));
    dashboardNotes(p, App.state.suite, meta).forEach(([label, text], i) => {
        const n = notesRow + 1 + i;
        row(n, cell(label, "xd-label", `A${n}`) + cell(escapeHtml(text), "xd-notes", `B${n}`, 'colspan="6"') + empty(3));
    });

    return `<table class="xl-table xl-dash">${xlColgroup(DASH_COLS)}${xlLetters(DASH_COLS)}<tbody>${rows.join("")}</tbody></table>`;
}

// Pie like the Excel chart: Passed 4F81BD, Failed C0504D, Blocked 9BBB59, Untested 8064A2; value and percentage labels; legend right
function xlPie(parts, total) {
    const cx = 120, cy = 112, r = 92;
    let angle = -Math.PI / 2;
    const slices = [];
    const labels = [];
    const shown = parts.filter(p => p[1] > 0);
    for (let [label, n, color] of shown) {
        const a = (n / total) * Math.PI * 2;
        const mid = angle + a / 2;
        if (shown.length === 1) {
            slices.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
        } else {
            const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
            const x2 = cx + r * Math.cos(angle + a), y2 = cy + r * Math.sin(angle + a);
            slices.push(`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${label}: ${n}</title></path>`);
        }
        const single = shown.length === 1;
        const lx = single ? cx : cx + r * 0.62 * Math.cos(mid), ly = single ? cy : cy + r * 0.62 * Math.sin(mid);
        labels.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="xl-pie-label">${n}; ${Math.round(n / total * 100)}%</text>`);
        angle += a;
    }
    const legend = parts.map(([label, , color], i) => `<g transform="translate(250 ${70 + i * 22})"><rect width="9" height="9" y="-8" fill="${color}"/><text x="15" class="xl-pie-legend">${label}</text></g>`).join("");
    return `<svg viewBox="0 0 340 230" class="xl-pie" role="img" aria-label="Overall test execution status">
        ${total ? slices.join("") + labels.join("") : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#eee"/>`}${legend}</svg>`;
}

// ---------- Test Data sheet ----------

function renderDataSheet() {
    const rows = [`<tr class="xl-h1"><th class="xl-rn">1</th>${["#", "Category", "Data Item", "Value", "Used By (Test Case IDs)", "Notes"].map((h, i) => `<td class="xl-head" data-ref="${colName(i)}1">${h}</td>`).join("")}</tr>`];
    exportData(App.state.data, App.state.suite).forEach((d, i) => {
        const n = i + 2;
        const p = `data.${d.order}`;
        rows.push(`<tr class="xl-step"><th class="xl-rn">${n}</th>
            <td class="xl-num">${xlText(String(i + 1), `A${n}`)}</td>
            <td>${xlEdit(`${p}.category`, d.category, `B${n}`)}</td>
            <td>${xlEdit(`${p}.item`, d.item, `C${n}`)}</td>
            <td class="${/^https?:/.test(d.value) ? "xl-link" : ""}">${xlEdit(`${p}.value`, d.value, `D${n}`)}</td>
            <td>${xlText(d.usedByText, `E${n}`)}</td>
            <td>${xlEdit(`${p}.notes`, d.notes, `F${n}`)}</td></tr>`);
    });
    const hidden = App.state.data.filter(d => d.item && d.category !== "Environment" && !usedBy(d.item, App.state.suite).length).length;
    const start = rows.length + 1;
    for (let i = 0; i < 6; i++) rows.push(`<tr class="xl-empty"><th class="xl-rn">${start + i}</th>${"<td></td>".repeat(6)}</tr>`);
    return `<table class="xl-table xl-data">${xlColgroup(DATA_COLS)}${xlLetters(DATA_COLS)}<tbody>${rows.join("")}</tbody></table>` +
        (hidden ? `<p class="xl-note">${hidden} Test Data row${hidden === 1 ? " is" : "s are"} used by no case and left out of the workbook, as the team format requires. Edit them on the Test Data tab.</p>` : "");
}

// ---------- Frame ----------

function renderWorkbook() {
    const grid = $("xlGrid");
    if (!grid) return;
    const scroll = { top: grid.scrollTop, left: grid.scrollLeft };
    $("xlFileName").textContent = (typeof baseName === "function" ? baseName() : "Test_Cases") + ".xlsx";
    const hasCases = App.state.suite.sections.length > 0;
    $("xlEmpty").hidden = hasCases;
    grid.hidden = !hasCases;
    document.querySelectorAll("[data-sheet]").forEach(b => b.classList.toggle("active", b.dataset.sheet === currentSheet));
    if (!hasCases) return;
    grid.innerHTML = currentSheet === "dashboard" ? renderDashSheet() : currentSheet === "data" ? renderDataSheet() : renderCaseSheet();
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
    const { errors } = checkSuite(App.state);
    $("xlCheck").textContent = errors.length ? `${errors.length} issue${errors.length === 1 ? "" : "s"}` : "Team format: PASS";
    $("xlCheck").className = "xl-check " + (errors.length ? "bad" : "good");
}

function initWorkbook() {
    document.querySelectorAll("[data-sheet]").forEach(b => b.addEventListener("click", () => {
        currentSheet = b.dataset.sheet;
        $("xlGrid").scrollTop = 0;
        renderWorkbook();
    }));
    const grid = $("xlGrid");
    // Name box and formula bar follow the selected cell
    const select = target => {
        const el = target.closest("[data-ref]");
        if (!el || !grid.contains(el)) return;
        $("xlNameBox").textContent = el.dataset.ref;
        $("xlFormula").textContent = el.tagName === "SELECT" ? el.value : el.innerText;
        grid.querySelectorAll(".xl-sel").forEach(x => x.classList.remove("xl-sel"));
        el.closest("td").classList.add("xl-sel");
    };
    grid.addEventListener("focusin", e => select(e.target));
    // Header, banner and other cells that cannot take focus are selected on click
    grid.addEventListener("click", e => {
        const focusable = e.target.closest("[contenteditable], select, [tabindex]");
        if (!focusable || !grid.contains(focusable)) select(e.target);
    });
    grid.addEventListener("input", e => {
        const el = e.target.closest("[data-ref]");
        if (el) $("xlFormula").textContent = el.tagName === "SELECT" ? el.value : el.innerText;
    });
    // Status and importance colours, actual results and the Dashboard follow the change
    grid.addEventListener("change", e => {
        if (e.target.matches("select")) setTimeout(renderWorkbook, 0);
    });
    grid.addEventListener("focusout", e => {
        if (e.target.closest('[data-bind^="data."], [data-bind^="project."]')) setTimeout(() => { if (!grid.contains(document.activeElement)) renderWorkbook(); }, 0);
    });
    $("xlCheck").addEventListener("click", openCheck);
    $("xlExport").addEventListener("click", () => $("exportBtn").click());
}
