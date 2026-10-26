// ---------- Smart commands ----------
// Turns a command into a scoped request, sends only what that command needs, validates the answer and opens the
// review. Scope: the selected cases, one module, or the whole suite.

const SMART_SHORTCUTS = [
    { label: "Improve test cases", text: "Improve these test cases: clearer single-condition descriptions, one action per step, exact UI wording from the specification." },
    { label: "Generate missing scenarios", text: "Find scenarios the specification describes that these cases do not cover, and add them.", sources: true },
    { label: "Check requirement coverage", text: "Check these cases against the specification. For each requirement without a case, add a case when the gap is clear, otherwise use suggest.", sources: true },
    { label: "Find duplicates", text: "Find duplicate or overlapping cases. Explain each with suggest; delete only exact duplicates." },
    { label: "Improve expected results", text: "Rewrite expected results so each is one observable sentence with exactly one should, quoting exact UI text; use To confirm: where the wording is not specified." },
    { label: "Add boundary cases", text: "Add boundary cases for these cases: limits, lengths, times, counts and dates just inside and just outside each boundary." },
    { label: "Add negative cases", text: "Add negative cases for these cases: invalid input, cancel, missing permission, interrupted network and error messages." },
    { label: "Review regression coverage", text: "Review regression coverage: existing behaviour these changes could break. Add REG cases and use suggest for anything uncertain." },
    { label: "Suggest test data", text: "Suggest concrete synthetic test data these cases need (names, PINs, job roles, dates, times) and update each case's data to cite it." },
    { label: "Check compliance with approved format", text: "Check these cases against the team format and the standard, and fix every case that breaks a rule." },
];

const SmartCommands = {
    target: "suite",        // selected · module · suite
    module: "",
    busy: false,

    scopeCases() {
        ensureUids(App.state.suite);
        const all = allCases(App.state.suite);
        if (this.target === "selected") return all.filter(x => App.selected.has(x.c.uid));
        if (this.target === "module") return all.filter(x => x.section.code === this.module);
        return all;
    },

    scopeLabel() {
        if (this.target === "selected") return `${App.selected.size} selected case${App.selected.size === 1 ? "" : "s"}`;
        if (this.target === "module") return `module ${this.module}`;
        return "the whole suite";
    },

    // Only what the command needs: the cases in scope (with stable uids), the Test Data rows they use plus the people
    // available for reuse, and the module list. Real e-mail addresses and secrets are removed before sending.
    context(cases) {
        const s = App.state;
        const used = new Set(cases.flatMap(x => x.c.data.split("\n").map(l => l.split(":")[0].trim().toLowerCase())));
        const data = s.data.filter(d => used.has(d.item.toLowerCase()) || d.category === "Users")
            .map(d => ({ category: d.category, item: d.item, value: d.value }));
        return {
            scope: this.scopeLabel(),
            modules: s.suite.sections.map(x => ({ code: x.code, title: x.title, cases: x.cases.length })),
            cases: cases.map(x => ({
                uid: x.c.uid, id: x.c.id, module: x.section.code, importance: x.c.importance, description: x.c.description,
                pre: x.c.pre, data: x.c.data, steps: x.c.steps.map(st => ({ action: st.action, expected: st.expected })),
            })),
            test_data: data,
        };
    },

    async run(command, { sources = false } = {}) {
        if (this.busy) return;
        if (!SmartSettings.ready()) {
            await SmartSettings.test({ quiet: true });
            if (!SmartSettings.ready()) {
                Chat.push("assistant", "Smart isn't connected, so nothing was sent. Open Smart settings to connect — Commands mode and Offline generation keep working.", "ai");
                SmartSettings.open();
                return;
            }
        }
        const cases = this.scopeCases();
        if (this.target === "selected" && !cases.length) { Chat.push("assistant", "Select cases first (tick them on the Test cases page), or choose a module or the whole suite.", "ai"); return; }
        const wantsSources = sources || (App.state.ai.useSources !== false && /spec|requirement|coverage|missing|release|document/i.test(command));
        const content = [];
        if (wantsSources && Sources.list.length) {
            content.push({ type: "text", text: `Specification files (${Sources.summary()}). A reference only — never the system under test.` });
            content.push(...Sources.blocks());
        }
        content.push({ type: "text", text: `Scope and current cases (JSON):\n${JSON.stringify(this.context(cases))}` });
        content.push({ type: "text", text: `Command: ${command}\nReturn proposals for ${this.scopeLabel()} only.` });

        this.busy = true;
        Chat.setBusy(true);
        const result = await SmartService.request({ task: "propose", content, effort: "medium" });
        Chat.setBusy(false);
        this.busy = false;
        if (result.error) { Chat.push("assistant", `${result.error} Your suite was not changed.`, "ai"); return; }

        const scopeUids = this.target === "suite" ? null : new Set(cases.map(x => x.c.uid));
        const checked = validateProposals(result.data, { scopeUids });
        if (checked.error) { Chat.push("assistant", checked.error, "ai"); return; }
        const n = checked.accepted.length;
        Chat.push("assistant", `${checked.summary ? checked.summary + "\n" : ""}${n} change${n === 1 ? "" : "s"} ready to review${checked.suggestions.length ? `, ${checked.suggestions.length} suggestion${checked.suggestions.length === 1 ? "" : "s"}` : ""}${checked.rejected.length ? `, ${checked.rejected.length} not offered (failed the mandatory rules)` : ""}. Nothing changes until you approve.`, "ai", { review: true });
        SmartReview.open(command, checked);
    },

    // Smart generation: one request per module, all proposals reviewed together before anything is written
    async generateModules(plan, header) {
        if (this.busy) return;
        this.busy = true;
        setAssistant(true, false);
        App.state.ai.enabled = true;
        Chat.renderMode();
        const merged = { summary: "", proposals: [], open_questions: [] };
        const sourceBlocks = Sources.list.length ? [{ type: "text", text: `Specification files (${Sources.summary()}). A reference only — never the system under test.` }, ...Sources.blocks()] : [];
        for (const [i, m] of plan.entries()) {
            Chat.push("user", `(${i + 1}/${plan.length}) Write ${m.code} — ${m.title}`, "ai");
            Chat.setBusy(true);
            const result = await SmartService.request({
                task: "propose", effort: "high",
                content: [...sourceBlocks, { type: "text", text: `Write module ${i + 1} of ${plan.length}: ${m.code} — ${m.title}. ${header}\nReturn op "add" proposals with module "${m.code}" (module_title "${m.title}") for every case this module needs under the team format's coverage rules, with the synthetic test data they cite. Only ${m.code}; the other modules are separate requests (${plan.map(p => p.code).join(", ")}).` }],
            });
            Chat.setBusy(false);
            if (result.error) {
                Chat.push("assistant", `${result.error} Stopped before ${m.code}; nothing was written. ${merged.proposals.length ? "The modules already answered are ready to review." : ""}`, "ai");
                break;
            }
            merged.proposals.push(...(result.data.proposals || []));
            merged.open_questions.push(...(result.data.open_questions || []));
            Chat.push("assistant", `${m.code}: ${(result.data.proposals || []).length} proposed case${(result.data.proposals || []).length === 1 ? "" : "s"}.`, "ai");
        }
        this.busy = false;
        if (!merged.proposals.length) return;
        merged.summary = `Proposed cases for ${[...new Set(merged.proposals.map(p => p.module))].filter(Boolean).join(", ")}.`;
        const checked = validateProposals(merged, { scopeUids: null });
        if (checked.error) { Chat.push("assistant", checked.error, "ai"); return; }
        SmartReview.open("Generate test cases (Smart)", checked);
    },

    renderTools() {
        const tools = $("smartTools");
        if (!tools) return;
        tools.hidden = !App.state.ai.enabled;
        $("smartSelectedCount").textContent = App.selected.size;
        const codes = App.state.suite.sections.map(s => s.code);
        if (!codes.includes(this.module)) this.module = codes[0] || "";
        $("smartModule").innerHTML = codes.map(c => `<option ${c === this.module ? "selected" : ""}>${c}</option>`).join("") || "<option value=''>—</option>";
        document.querySelectorAll("[name=smartTarget]").forEach(r => { r.checked = r.value === this.target; });
        $("smartShortcuts").innerHTML = SMART_SHORTCUTS.map((s, i) => `<button type="button" class="chip" data-shortcut="${i}">${escapeHtml(s.label)}</button>`).join("");
        SmartSettings.render();
    },

    init() {
        $("smartTools").addEventListener("change", e => {
            if (e.target.name === "smartTarget") this.target = e.target.value;
            if (e.target.id === "smartModule") { this.module = e.target.value; this.target = "module"; this.renderTools(); }
        });
        $("smartShortcuts").addEventListener("click", e => {
            const b = e.target.closest("[data-shortcut]");
            if (!b) return;
            const s = SMART_SHORTCUTS[+b.dataset.shortcut];
            Chat.push("user", `${s.label} — ${this.scopeLabel()}`, "ai");
            this.run(s.text, { sources: !!s.sources });
        });
        $("smartHistoryBtn").addEventListener("click", () => SmartReview.openHistory());
        // Case selection on the Test cases page
        $("suite").addEventListener("change", e => {
            const box = e.target.closest("[data-select]");
            if (!box) return;
            box.checked ? App.selected.add(box.dataset.select) : App.selected.delete(box.dataset.select);
            if (App.selected.size) this.target = "selected";
            this.renderTools();
        });
    },
};
