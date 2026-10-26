// ---------- Smart change review ----------
// Proposals are shown as a before/after comparison. Nothing changes until the tester selects changes and applies
// them; rejecting leaves the suite untouched. Applied changes renumber IDs, sync Test Data, re-run the full check,
// and are saved in History with Undo.

const SmartReview = {
    current: null,          // { command, accepted, rejected, suggestions, summary, openQuestions }

    open(command, result) {
        this.current = { command, ...result };
        this.selected = new Set(result.accepted.map((_, i) => i));
        this.render();
        const dlg = $("smartReviewDialog");
        if (!dlg.open) dlg.showModal();
    },

    fieldRows(before, after) {
        const rows = [];
        const text = v => escapeHtml(v || "").replace(/\n/g, "<br>") || '<span class="muted">—</span>';
        const steps = c => c ? c.steps.map((s, i) => `<li><span>${escapeHtml(s.action)}</span><em>${escapeHtml(s.expected)}</em></li>`).join("") : "";
        for (const [label, key] of [["Description", "description"], ["Importance", "importance"], ["Preconditions", "pre"], ["Test Data", "data"]]) {
            const b = before ? before[key] : "", a = after ? after[key] : "";
            if (before && after && b === a) continue;
            rows.push(`<tr><th>${label}</th><td class="diff-before">${before ? text(b) : ""}</td><td class="diff-after">${after ? text(a) : ""}</td></tr>`);
        }
        const sb = before ? JSON.stringify(before.steps.map(s => [s.action, s.expected])) : "", sa = after ? JSON.stringify(after.steps.map(s => [s.action, s.expected])) : "";
        if (sb !== sa) rows.push(`<tr><th>Steps</th><td class="diff-before">${before ? `<ol>${steps(before)}</ol>` : ""}</td><td class="diff-after">${after ? `<ol>${steps(after)}</ol>` : ""}</td></tr>`);
        return rows.join("");
    },

    render() {
        const r = this.current;
        if (!r) return;
        $("smartReviewCommand").textContent = r.command;
        $("smartReviewSummary").textContent = r.summary || "";
        const opLabel = { add: "Add", update: "Update", delete: "Delete" };
        $("smartReviewList").innerHTML = (r.accepted.length ? r.accepted.map((x, i) => {
            const p = x.p;
            const who = p.op === "add" ? `New case in ${x.section}` : `${x.before.id}`;
            return `
            <article class="proposal">
                <label class="proposal-head">
                    <input type="checkbox" data-pick="${i}" ${this.selected.has(i) ? "checked" : ""} aria-label="Apply this change">
                    <span class="op op-${p.op}">${opLabel[p.op]}</span>
                    <strong>${escapeHtml(who)}</strong>
                    <span class="muted">${escapeHtml((x.after || x.before).description)}</span>
                </label>
                <p class="proposal-why">${escapeHtml(p.explanation)}</p>
                ${p.sources.length ? `<p class="proposal-meta"><b>Sources</b> ${p.sources.map(escapeHtml).join(" · ")}</p>` : ""}
                ${p.assumptions.length ? `<p class="proposal-meta warn"><b>Assumptions</b> ${p.assumptions.map(escapeHtml).join(" · ")}</p>` : ""}
                ${p.test_data.length ? `<p class="proposal-meta"><b>Adds Test Data</b> ${p.test_data.map(d => `${escapeHtml(d.item)}: ${escapeHtml(d.value)}`).join(" · ")}</p>` : ""}
                <table class="diff"><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>${this.fieldRows(x.before, x.after)}</tbody></table>
            </article>`;
        }).join("") : `<p class="hint">No changes passed validation.</p>`) +
        (r.suggestions.length ? `<section class="proposal-group"><h3>Suggestions (${r.suggestions.length}) <small>advice only — nothing to apply</small></h3>${r.suggestions.map(p => `<p class="suggestion">${escapeHtml(p.explanation)}${p.sources.length ? ` <span class="muted">(${p.sources.map(escapeHtml).join(", ")})</span>` : ""}</p>`).join("")}</section>` : "") +
        (r.openQuestions.length ? `<section class="proposal-group"><h3>Open questions</h3><ul>${r.openQuestions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul></section>` : "") +
        (r.rejected.length ? `<details class="proposal-group rejected"><summary>Not offered — failed the mandatory rules (${r.rejected.length})</summary>${r.rejected.map(x => `<div class="rejected-item"><b>${escapeHtml((x.p && x.p.op) || "?")}</b> ${escapeHtml((x.p && x.p.fields && x.p.fields.description) || (x.p && x.p.target_uid) || "")}<ul>${x.reasons.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>`).join("")}</details>` : "");
        $("smartApply").textContent = `Apply selected (${this.selected.size})`;
        $("smartApply").disabled = !this.selected.size;
    },

    // Apply the selected proposals in one undoable step
    apply() {
        const r = this.current;
        if (!r || !this.selected.size) return;
        const picks = r.accepted.filter((_, i) => this.selected.has(i));
        const s = App.state;
        App.snapshot("Smart changes");
        const before = checkSuite(s).errors.length;
        const order = code => { const i = Object.keys(TAIL_SECTIONS).indexOf(code); return i < 0 ? -1 : i; };
        const sectionFor = (code, title) => {
            let sec = s.suite.sections.find(x => x.code === code);
            if (!sec) {
                sec = { code, name: TAIL_SECTIONS[code] ? TAIL_SECTIONS[code].name : (MODULE_NAMES[code] || code), title: title || (TAIL_SECTIONS[code] ? TAIL_SECTIONS[code].title : MODULE_NAMES[code] || code), cases: [] };
                // Functional modules before UI, API, DB, INT, RPT, REG, EDG
                const at = s.suite.sections.findIndex(x => order(x.code) > order(code) && (order(code) >= 0 || order(x.code) >= 0));
                if (at < 0) s.suite.sections.push(sec); else s.suite.sections.splice(at, 0, sec);
            }
            return sec;
        };
        // Smart generation: approved cases replace the current suite (the snapshot above makes it undoable)
        if (this.replaceOnApply && picks.some(x => x.p.op === "add")) s.suite = { sections: [] };
        this.replaceOnApply = false;
        const byUid = () => new Map(allCases(s.suite).map(x => [x.c.uid, x]));
        for (const x of picks) {
            for (const d of x.p.test_data) {
                const row = s.data.find(y => y.item.toLowerCase() === d.item.toLowerCase());
                if (row) Object.assign(row, { category: d.category, value: d.value, notes: d.notes || row.notes });
                else s.data.push({ category: d.category, item: d.item, value: d.value, notes: d.notes });
            }
            const map = byUid();
            if (x.p.op === "add") {
                sectionFor(x.section, x.p.module_title).cases.push({ ...structuredClone(x.after), uid: "", id: "" });
            } else if (x.p.op === "update") {
                const t = map.get(x.p.target_uid);
                if (t) t.section.cases[t.section.cases.indexOf(t.c)] = { ...structuredClone(x.after), uid: t.c.uid, id: t.c.id, evidence: t.c.evidence || "" };
            } else if (x.p.op === "delete") {
                const t = map.get(x.p.target_uid);
                if (t) t.section.cases.splice(t.section.cases.indexOf(t.c), 1);
            }
        }
        s.suite.sections = s.suite.sections.filter(x => x.cases.length);
        ensureUids(s.suite);
        numberCases(s.suite, s.project);            // IDs stay sequential without gaps
        App.afterChange();                          // Test Data "Used By", counts and the Dashboard follow
        const check = checkSuite(s);
        this.log({ command: r.command, applied: picks.length, offered: r.accepted.length, rejected: r.rejected.length, suggestions: r.suggestions.length, outcome: "applied", errorsAfter: check.errors.length });
        History.checkpoint("Smart changes applied");
        $("smartReviewDialog").close();
        this.current = null;
        const delta = check.errors.length - before;
        Chat.push("assistant", `Applied ${picks.length} of ${r.accepted.length} change${r.accepted.length === 1 ? "" : "s"}. ${check.errors.length ? `Check: ${check.errors.length} issue${check.errors.length === 1 ? "" : "s"}${delta > 0 ? ` (${delta} new)` : ""} — open Check to see them.` : "Check: PASS."}`, "ai", { changed: true });
    },

    reject() {
        const r = this.current;
        if (r) this.log({ command: r.command, applied: 0, offered: r.accepted.length, rejected: r.rejected.length, suggestions: r.suggestions.length, outcome: "rejected" });
        if ($("smartReviewDialog").open) $("smartReviewDialog").close();
        this.current = null;
        this.replaceOnApply = false;
        Chat.push("assistant", "No changes were applied.", "ai");
    },

    log(entry) {
        const list = App.state.smartLog = App.state.smartLog || [];
        list.unshift({ at: new Date().toISOString(), ...entry });
        if (list.length > 40) list.length = 40;
        App.save();
    },

    openHistory() {
        const list = App.state.smartLog || [];
        $("smartHistoryList").innerHTML = list.length ? list.map((e, i) => `
            <div class="smart-log ${e.outcome}">
                <div><strong>${escapeHtml(e.command)}</strong><span class="muted"> · ${escapeHtml(timeAgo(e.at))}</span></div>
                <div class="muted">${e.outcome === "applied" ? `Applied ${e.applied} of ${e.offered}` : e.outcome === "undone" ? `Applied ${e.applied}, then undone` : "Rejected — nothing changed"}${e.rejected ? ` · ${e.rejected} failed validation` : ""}${e.suggestions ? ` · ${e.suggestions} suggestion${e.suggestions === 1 ? "" : "s"}` : ""}${e.outcome === "applied" ? ` · check ${e.errorsAfter ? e.errorsAfter + " issue(s)" : "PASS"}` : ""}</div>
                ${i === 0 && e.outcome === "applied" && App.undoStack.length && App.undoStack[App.undoStack.length - 1].label === "Smart changes" ? `<button type="button" class="btn btn-sm" data-smart-undo>Undo these changes</button>` : ""}
            </div>`).join("") : `<p class="hint">No Smart changes yet.</p>`;
        $("smartHistoryDialog").showModal();
    },

    init() {
        $("smartReviewList").addEventListener("change", e => {
            const pick = e.target.closest("[data-pick]");
            if (!pick) return;
            pick.checked ? this.selected.add(+pick.dataset.pick) : this.selected.delete(+pick.dataset.pick);
            $("smartApply").textContent = `Apply selected (${this.selected.size})`;
            $("smartApply").disabled = !this.selected.size;
        });
        $("smartSelectAll").addEventListener("click", () => {
            const all = this.current && this.selected.size < this.current.accepted.length;
            this.selected = new Set(all ? this.current.accepted.map((_, i) => i) : []);
            this.render();
        });
        $("smartApply").addEventListener("click", () => this.apply());
        $("smartReject").addEventListener("click", () => this.reject());
        $("smartReviewClose").addEventListener("click", () => this.reject());
        $("smartReviewDialog").addEventListener("cancel", e => { e.preventDefault(); this.reject(); });
        $("smartHistoryClose").addEventListener("click", () => $("smartHistoryDialog").close());
        $("smartHistoryList").addEventListener("click", e => {
            if (!e.target.closest("[data-smart-undo]")) return;
            if (App.undo()) {
                const last = (App.state.smartLog || [])[0];
                if (last) last.outcome = "undone";
                App.save();
                App.toast("Smart changes undone.");
            }
            $("smartHistoryDialog").close();
        });
    },
};
