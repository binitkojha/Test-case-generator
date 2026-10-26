// ---------- Screen recording viewer ----------
// Watch an uploaded recording, see the screens found in it, note what happens on each one and capture
// extra moments. The notes become a numbered flow that both engines use to write the test cases.

const VideoViewer = {
    source: null,
    url: null,
    saveTimer: null,

    el(id) { return document.getElementById(id); },

    open(id) {
        const s = Sources.list.find(x => x.id === id);
        if (!s) return;
        this.source = s;
        s.images = s.images || [];
        const dialog = this.el("videoDialog");
        this.el("videoTitle").textContent = s.name;
        const player = this.el("videoPlayer");
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = s.blob ? URL.createObjectURL(s.blob) : null;
        player.hidden = !this.url;
        this.el("videoNoBlob").hidden = !!this.url;
        if (this.url) player.src = this.url; else player.removeAttribute("src");
        this.el("videoCapture").disabled = this.el("videoRedetect").disabled = !this.url;
        this.render();
        if (!dialog.open) dialog.showModal();
    },

    close() {
        this.flush();
        const player = this.el("videoPlayer");
        player.pause();
        player.removeAttribute("src");
        player.load();
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = null;
        this.source = null;
        if (this.el("videoDialog").open) this.el("videoDialog").close();
        renderSources();
        renderGenerateHint();
    },

    frames() {
        return (this.source.images || []).slice().sort((a, b) => (a.time || 0) - (b.time || 0));
    },

    render() {
        const s = this.source;
        const frames = this.frames();
        s.images = frames;
        const noted = frames.filter(f => (f.note || "").trim()).length;
        this.el("videoMeta").textContent = [
            s.duration ? `Length ${formatTime(s.duration)}` : "",
            `${frames.length} screen${frames.length === 1 ? "" : "s"}`,
            `${noted} with notes`,
        ].filter(Boolean).join(" · ");
        this.el("videoFrames").innerHTML = frames.length ? frames.map((f, i) => `
            <div class="vframe" data-index="${i}">
                <button type="button" class="vframe-thumb" data-seek="${f.time || 0}" title="Play from ${escapeHtml(f.label || "")}">
                    <img src="data:${f.mime};base64,${f.data}" alt="Screen ${i + 1}">
                    <span>${i + 1} · ${escapeHtml(formatTime(f.time || 0))}</span>
                </button>
                <div class="vframe-body">
                    <textarea rows="2" data-note="${i}" placeholder="What happens here? e.g. Tap Clock In — the Confirm screen opens">${escapeHtml(f.note || "")}</textarea>
                    <button type="button" class="icon-btn danger" data-drop="${i}" title="Remove this screen" aria-label="Remove screen ${i + 1}">✕</button>
                </div>
            </div>`).join("")
            : `<p class="hint">No screens yet. Play the recording and select "Capture this moment".</p>`;
        this.el("videoCopy").disabled = !noted;
    },

    // Notes are saved a moment after typing stops
    queueSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 400);
    },
    flush() {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.source) Sources.save(this.source);
    },

    capture() {
        const player = this.el("videoPlayer");
        if (!player.videoWidth) { App.toast("Play the recording first, then capture."); return; }
        const t = player.currentTime;
        if (this.source.images.some(f => Math.abs((f.time || 0) - t) < 0.3)) { App.toast(`A screen at ${formatTime(t)} is already in the list.`); return; }
        this.source.images.push(captureFrame(player, t));
        this.render();
        this.flush();
        const idx = this.frames().findIndex(f => Math.abs((f.time || 0) - t) < 0.01);
        const box = this.el("videoFrames").querySelector(`[data-note="${idx}"]`);
        if (box) { box.scrollIntoView({ block: "nearest" }); box.focus(); }
    },

    async redetect() {
        const s = this.source;
        const notes = s.images.filter(f => (f.note || "").trim());
        if (!confirm(`Find the screens in ${s.name} again? Screens you noted (${notes.length}) are kept; the others are replaced.`)) return;
        const btn = this.el("videoRedetect");
        const original = btn.textContent;
        btn.disabled = true;
        try {
            const { video, url } = await openVideoElement(s.blob);
            try {
                const found = await detectScenes(video, text => { btn.textContent = text; });
                const fresh = found.filter(f => !notes.some(n => Math.abs((n.time || 0) - f.time) < 0.8));
                s.images = [...notes, ...fresh];
            } finally {
                URL.revokeObjectURL(url);
            }
            this.render();
            this.flush();
            App.toast(`${s.images.length} screens in the recording.`);
        } catch (e) {
            App.toast("Could not read the recording — " + e.message);
        } finally {
            btn.textContent = original;
            btn.disabled = false;
        }
    },

    // Copy the noted flow into the test basis so it can be edited there (then it is no longer added twice)
    copyToBasis() {
        const flow = recordingFlow(this.source, true);
        if (!flow) return;
        App.state.basisText = ((App.state.basisText || "").trim() + "\n\n" + flow).trim();
        this.source.notesCopied = true;
        App.save();
        this.flush();
        fillBindings($("s-basis"));
        renderBasisStats();
        App.toast("The steps from the recording are in the test basis — edit them there.");
    },

    generateNow() {
        this.close();
        switchTab("setup");
        generate();
    },

    init() {
        const frames = this.el("videoFrames");
        frames.addEventListener("click", e => {
            const seek = e.target.closest("[data-seek]");
            if (seek && this.url) {
                const player = this.el("videoPlayer");
                player.currentTime = Number(seek.dataset.seek);
                player.pause();
                return;
            }
            const drop = e.target.closest("[data-drop]");
            if (drop) {
                const list = this.frames();
                list.splice(Number(drop.dataset.drop), 1);
                this.source.images = list;
                this.render();
                this.flush();
            }
        });
        frames.addEventListener("input", e => {
            const box = e.target.closest("[data-note]");
            if (!box) return;
            this.frames()[Number(box.dataset.note)].note = box.value;
            this.source.notesCopied = false;
            const noted = this.source.images.filter(f => (f.note || "").trim()).length;
            this.el("videoMeta").textContent = this.el("videoMeta").textContent.replace(/\d+ with notes/, `${noted} with notes`);
            this.el("videoCopy").disabled = !noted;
            this.queueSave();
        });
        this.el("videoCapture").addEventListener("click", () => this.capture());
        this.el("videoRedetect").addEventListener("click", () => this.redetect());
        this.el("videoCopy").addEventListener("click", () => this.copyToBasis());
        this.el("videoGenerate").addEventListener("click", () => this.generateNow());
        this.el("videoClose").addEventListener("click", () => this.close());
        this.el("videoDone").addEventListener("click", () => this.close());
        this.el("videoDialog").addEventListener("cancel", e => { e.preventDefault(); this.close(); });
    },
};

// The noted screens of a recording as a numbered flow (offline generator + test basis)
function recordingFlow(v, includeCopied = false) {
    if (v.notesCopied && !includeCopied) return "";
    const noted = (v.images || []).filter(i => (i.note || "").trim()).sort((a, b) => (a.time || 0) - (b.time || 0));
    if (!noted.length) return "";
    return `## Flow from recording: ${v.name.replace(/\.[^.]+$/, "")}\n` +
        noted.map((i, k) => `${k + 1}. ${noteSentences(i.note)}`).join("\n");
}

// "Tap Next — the Job code screen opens" → "Tap Next. The Job code screen opens." so the reader pairs the action with its result
function noteSentences(note) {
    return note.trim().replace(/\s*\n+\s*/g, " ")
        .replace(/\s+(?:—|–|-{1,2}>|→|=>|-)\s+(\S)/g, (m, c) => ". " + c.toUpperCase())
        .replace(/([^.!?"])$/, "$1.");
}
