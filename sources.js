// Uploaded sources: any file the tester has — screenshots, screen recordings, release notes, specs, slides,
// spreadsheets, emails, archives. Kept in IndexedDB (this browser only) and sent to Claude with AI requests:
// images as image blocks, PDFs as document blocks, everything else as extracted text.
// One upload can become several sources (a recording → frames, a Word file → text + its screenshots, a ZIP → its files).

const MAX_IMAGE_EDGE = 1568;                  // long edge Claude reads at full detail
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 400000;
const MAX_FRAMES = 12;                        // screenshots taken from one screen recording
const MAX_EMBEDDED_IMAGES = 20;               // screenshots kept from one Word / PowerPoint / email
const REQUEST_BUDGET = 28 * 1024 * 1024;      // keep one AI request under the 32 MB API limit
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg|tiff?|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|avi|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|wma)$/i;

const Sources = {
    list: [],

    // ---------- IndexedDB ----------
    db() {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open("tcg-sources", 1);
                req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "id" });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return this.dbPromise;
    },
    async tx(mode, fn) {
        const db = await this.db();
        return new Promise((resolve, reject) => {
            const t = db.transaction("files", mode);
            const result = fn(t.objectStore("files"));
            t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
            t.onerror = () => reject(t.error);
        });
    },
    async load() {
        try {
            const all = await this.tx("readonly", store => store.getAll());
            this.list = (all || []).sort((a, b) => a.added - b.added);
            await this.regroupLegacy();
        } catch (e) {
            this.list = [];          // storage blocked: sources live in memory only
        }
    },
    // Files saved by the earlier version stored each slide / document image and each video frame as its own
    // source ("Deck.pptx · image3.png", "clip.webm @ 0:05"). Group them under their file again, without repeats.
    async regroupLegacy() {
        const loose = this.list.filter(s => s.kind === "image" && s.from);
        if (!loose.length) return;
        for (let img of loose) {
            let parent = this.list.find(p => p !== img && p.name === img.from && !p.from);
            if (!parent && img.frame) {
                parent = { ...sourceBase(img.from, 0), kind: "video", images: [] };
                this.list.push(parent);
            }
            if (!parent) continue;
            parent.images = parent.images || [];
            const key = img.data.length + img.data.slice(0, 64) + img.data.slice(-64);
            if (!parent.images.some(i => i.data.length + i.data.slice(0, 64) + i.data.slice(-64) === key)) {
                parent.images.push({ mime: img.mime, data: img.data, width: img.width, height: img.height, label: img.frame ? `at ${img.frame}` : img.name.split(" · ").pop() });
            }
            parent.size = parent.size || 0;
            this.list = this.list.filter(s => s !== img);
            try { await this.tx("readwrite", store => store.delete(img.id)); } catch (e) { /* ignore */ }
            await this.save(parent);
        }
    },

    async save(source) {
        try { await this.tx("readwrite", store => store.put(source)); } catch (e) { /* memory only */ }
    },
    async remove(id) {
        this.list = this.list.filter(s => s.id !== id);
        try { await this.tx("readwrite", store => store.delete(id)); } catch (e) { /* ignore */ }
    },
    async clear() {
        this.list = [];
        try { await this.tx("readwrite", store => store.clear()); } catch (e) { /* ignore */ }
    },
    // Swap in the sources saved with a History entry
    async replace(list) {
        await this.clear();
        for (let s of list || []) {
            this.list.push(s);
            await this.save(s);
        }
        renderSources();
    },

    // ---------- Adding files ----------
    async addFiles(files, onProgress = () => {}) {
        const added = [];
        const failed = [];
        const notes = [];
        for (let [i, file] of files.entries()) {
            onProgress(`Reading ${file.name} (${i + 1}/${files.length})…`);
            try {
                const sources = await readSources(file, 0, text => onProgress(`${file.name}: ${text}`));
                for (let source of sources) {
                    if (this.list.some(s => s.name === source.name && s.size === source.size)) continue;
                    this.list.push(source);
                    await this.save(source);
                    added.push(source);
                    if (source.kind === "other") notes.push(`${source.name}: ${source.note}`);
                }
            } catch (error) {
                failed.push(`${file.name}: ${error.message}`);
            }
        }
        return { added, failed, notes };
    },

    // One uploaded file = one source. A source can carry text, a PDF, its own image, embedded images
    // (slides, document screenshots, video frames) or child files (archives).
    flat(list = this.list) {
        return list.flatMap(s => s.kind === "archive" ? this.flat(s.children || []) : [s]);
    },

    imageCount(s) {
        return (s.kind === "image" ? 1 : 0) + (s.images ? s.images.length : 0) + (s.children ? s.children.reduce((n, c) => n + this.imageCount(c), 0) : 0);
    },

    // All readable text, for the offline generator — including the tester's notes on recording frames, as a numbered flow
    texts() {
        const out = this.flat().filter(s => (s.text || "").trim()).map(s => ({ name: s.name, text: s.text, kind: s.kind }));
        for (let v of this.flat().filter(s => s.kind === "video")) {
            const flow = recordingFlow(v);
            if (flow) out.push({ name: v.name, kind: "video", text: flow });
        }
        return out;
    },

    bytes() {
        const size = s => (s.data ? s.data.length * 0.75 : 0) + (s.text ? s.text.length : 0) +
            (s.images ? s.images.reduce((n, i) => n + i.data.length * 0.75, 0) : 0);
        return this.flat().reduce((n, s) => n + size(s), 0);
    },

    summary() {
        const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
        const all = this.flat();
        const images = all.reduce((n, s) => n + this.imageCount(s), 0);
        const unreadable = all.filter(s => s.kind === "other").length;
        const parts = [plural(this.list.length, "file")];
        if (images) parts.push(plural(images, "image"));
        if (unreadable) parts.push(`${unreadable} not readable`);
        return parts.join(" · ");
    },

    // Content blocks for the Messages API. The last block carries the cache breakpoint so
    // module-by-module requests reuse the uploaded sources from the prompt cache.
    blocks() {
        const blocks = [];
        let budget = REQUEST_BUDGET;
        const skipped = [];
        const fits = (name, size) => {
            if (size > budget) { skipped.push(name); return false; }
            budget -= size;
            return true;
        };
        const image = (label, img) => {
            if (!fits(label, img.data.length)) return;
            blocks.push({ type: "text", text: label });
            blocks.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data } });
        };
        for (let s of this.flat()) {
            if (s.kind === "image") {
                image(`Screenshot: ${s.name}`, s);
            } else if (s.kind === "pdf") {
                if (fits(s.name, s.data.length)) blocks.push({ type: "document", title: s.name, source: { type: "base64", media_type: "application/pdf", data: s.data } });
            } else if (s.kind === "text") {
                if (fits(s.name, s.text.length)) blocks.push({ type: "document", title: s.name, source: { type: "text", media_type: "text/plain", data: s.text || "(empty)" } });
            } else if (s.kind === "other") {
                blocks.push({ type: "text", text: `Uploaded file "${s.name}" could not be read (${s.note}). Ask the tester for its content if it matters.` });
            }
            (s.images || []).forEach((img, i, all) => image(s.kind === "video"
                ? `Frame ${i + 1} of ${all.length} from screen recording ${s.name}${img.label ? ` ${img.label}` : ""}${(img.note || "").trim() ? ` — tester note: ${img.note.trim()}` : ""}`
                : `Image from ${s.name}${img.label ? ` — ${img.label}` : ""}`, img));
        }
        if (skipped.length) blocks.push({ type: "text", text: `Not sent because the request size limit was reached: ${skipped.join(", ")}.` });
        if (blocks.length) blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
        return blocks;
    },
};

// ---------- Readers ----------

function fileToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function base64Of(dataUrl) {
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function newSourceId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sourceBase(name, size) {
    return { id: newSourceId(), name, size, added: Date.now() };
}

function canvasToImage(canvas) {
    let url = canvas.toDataURL("image/png");
    let mime = "image/png";
    if (url.length * 0.75 > MAX_IMAGE_BYTES) {
        url = canvas.toDataURL("image/jpeg", 0.9);
        mime = "image/jpeg";
    }
    return { mime, data: base64Of(url), width: canvas.width, height: canvas.height };
}

function scaledCanvas(source, width, height) {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";                    // transparent PNG / SVG → white, as on screen
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

// Decode through an <img> element — covers SVG and formats createImageBitmap rejects
function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
        img.src = url;
    });
}

// Screenshots: keep text sharp (PNG) within Claude's size and format limits
async function prepareImage(blob) {
    const supported = /^image\/(png|jpeg|gif|webp)$/.test(blob.type);
    let bitmap = null;
    try { bitmap = await createImageBitmap(blob); } catch (e) { /* try <img> below */ }
    if (bitmap) {
        if (supported && Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_EDGE && blob.size <= MAX_IMAGE_BYTES) {
            return { mime: blob.type, data: base64Of(await fileToDataUrl(blob)), width: bitmap.width, height: bitmap.height };
        }
        return canvasToImage(scaledCanvas(bitmap, bitmap.width, bitmap.height));
    }
    const img = await loadImageElement(blob);
    const w = img.naturalWidth || 1280, h = img.naturalHeight || 800;
    return canvasToImage(scaledCanvas(img, w, h));
}

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff" };

function extOf(name) {
    return (name.split(".").pop() || "").toLowerCase();
}

async function imageSource(blob, name, extra = {}) {
    const typed = blob.type ? blob : new Blob([blob], { type: MIME_BY_EXT[extOf(name)] || "" });
    try {
        return { ...sourceBase(name, typed.size), kind: "image", ...(await prepareImage(typed)), ...extra };
    } catch (e) {
        return { ...sourceBase(name, typed.size), kind: "other", note: "this image format can't be opened in the browser — save it as PNG or JPG", ...extra };
    }
}

// ---------- Screen recordings ----------
// The video itself is kept (so it can be watched in the app) and a frame is captured whenever the screen changes.

const SCENE_THRESHOLD = 10;          // average colour change per channel (0–255) that counts as a new screen
const MAX_SCENE_FRAMES = 24;

function formatTime(t) {
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

function seekVideo(video, t) {
    return new Promise(resolve => {
        const done = () => { video.removeEventListener("seeked", done); resolve(); };
        video.addEventListener("seeked", done);
        video.currentTime = t;
        setTimeout(done, 2000);
    });
}

async function openVideoElement(blob) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = url;
    await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error("this video format can't be played in the browser — export it as MP4 or WEBM"));
    });
    // Recordings made in a browser (MediaRecorder WEBM) often report an unknown length until seeked to the end
    if (!isFinite(video.duration)) {
        await new Promise(resolve => {
            const done = () => { video.ondurationchange = null; resolve(); };
            video.ondurationchange = () => { if (isFinite(video.duration)) done(); };
            setTimeout(done, 3000);
            video.currentTime = 1e7;
        });
        await seekVideo(video, 0);
    }
    return { video, url };
}

function captureFrame(video, t) {
    const canvas = scaledCanvas(video, video.videoWidth || 1280, video.videoHeight || 720);
    const url = canvas.toDataURL("image/jpeg", 0.88);
    return { mime: "image/jpeg", data: base64Of(url), width: canvas.width, height: canvas.height, time: t, label: `at ${formatTime(t)}`, note: "" };
}

// Sample the recording, keep a frame each time the picture changes enough, then capture those frames at full size
async function detectScenes(video, onProgress = () => {}) {
    const duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!duration) return [captureFrame(video, 0)];
    const step = Math.max(0.5, duration / 240);
    const small = document.createElement("canvas");
    small.width = 64;
    small.height = 36;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    const grey = () => {
        sctx.drawImage(video, 0, 0, 64, 36);
        const d = sctx.getImageData(0, 0, 64, 36).data;
        // Colour, not just brightness: a button turning from green to red is a new screen too
        const g = new Uint8Array(64 * 36 * 3);
        for (let i = 0, j = 0; i < d.length; i += 4) { g[j++] = d[i]; g[j++] = d[i + 1]; g[j++] = d[i + 2]; }
        return g;
    };
    const scenes = [];
    let last = null;
    for (let t = 0; t < duration; t += step) {
        await seekVideo(video, Math.min(t, duration - 0.05));
        const g = grey();
        let diff = 255;
        if (last) {
            let sum = 0;
            for (let i = 0; i < g.length; i++) sum += Math.abs(g[i] - last[i]);
            diff = sum / g.length;
        }
        if (!last || diff > SCENE_THRESHOLD) { scenes.push({ t, diff }); last = g; }
        onProgress(`Finding screens… ${Math.round((t / duration) * 100)}%`);
    }
    // Too many changes (scrolling, animation): keep the biggest ones, always the first
    let picked = scenes;
    if (scenes.length > MAX_SCENE_FRAMES) {
        picked = [scenes[0], ...scenes.slice(1).sort((a, b) => b.diff - a.diff).slice(0, MAX_SCENE_FRAMES - 1)].sort((a, b) => a.t - b.t);
    }
    const frames = [];
    for (let s of picked) {
        // A moment after the change, so animations have settled
        const t = Math.min(duration - 0.05, s.t + Math.min(0.6, step));
        await seekVideo(video, t);
        frames.push(captureFrame(video, t));
    }
    // The end state of the recording, when it differs from the last screen
    await seekVideo(video, Math.max(0, duration - 0.1));
    const endGrey = grey();
    if (last) {
        let sum = 0;
        for (let i = 0; i < endGrey.length; i++) sum += Math.abs(endGrey[i] - last[i]);
        if (sum / endGrey.length > SCENE_THRESHOLD / 2 && frames.length < MAX_SCENE_FRAMES + 1) frames.push(captureFrame(video, Math.max(0, duration - 0.1)));
    }
    return frames;
}

async function videoFrames(file, onProgress = () => {}) {
    const { video, url } = await openVideoElement(file);
    try {
        const images = await detectScenes(video, onProgress);
        return [{
            ...sourceBase(file.name, file.size), kind: "video", mime: file.type || "video/mp4",
            duration: isFinite(video.duration) ? video.duration : 0, width: video.videoWidth, height: video.videoHeight,
            blob: file,                                       // kept so the recording can be watched in the app
            images,
        }];
    } finally {
        URL.revokeObjectURL(url);
    }
}

// A quick fingerprint so the same picture repeated on many slides is kept once
function imageKey(bytes) {
    let h = bytes.length;
    const step = Math.max(1, Math.floor(bytes.length / 512));
    for (let i = 0; i < bytes.length; i += step) h = (h * 31 + bytes[i]) | 0;
    return h;
}

// Images stored inside a file (word/media, ppt/media, Pictures/) — kept with that file, without icons,
// logos and repeats, so one deck or document stays one source
async function embeddedImages(read, prefix) {
    const names = read.names.filter(n => n.startsWith(prefix) && IMAGE_EXT.test(n)).slice(0, 80);
    const out = [];
    const seen = new Set();
    for (let name of names) {
        if (out.length >= MAX_EMBEDDED_IMAGES) break;
        const bytes = await read.bytes(name);
        if (!bytes || bytes.length < 12000) continue;            // icons, logos, bullets
        const key = imageKey(bytes);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            const img = await prepareImage(new Blob([bytes], { type: MIME_BY_EXT[extOf(name)] || "" }));
            if (img.width < 200 || img.height < 120) continue;  // decorations, not screens
            out.push({ ...img, label: name.split("/").pop() });
        } catch (e) { /* format the browser can't decode: skip */ }
    }
    return out;
}

function textOfTags(xml, tag) {
    return Array.from(parseXml(xml).getElementsByTagName(tag)).map(t => t.textContent);
}

// Word: paragraphs and table rows from word/document.xml
function docxXmlText(xml) {
    const doc = parseXml(xml);
    const lines = [];
    const body = doc.getElementsByTagName("w:body")[0] || doc.documentElement;
    // Heading styles become "#" headings and Word's automatic numbering becomes "1." / "-", so the
    // offline reader sees the same structure the author sees
    let listNo = 0;
    const walk = node => {
        for (let child of Array.from(node.childNodes)) {
            if (child.nodeName === "w:p") {
                const text = Array.from(child.getElementsByTagName("w:t")).map(t => t.textContent).join("");
                const style = (child.getElementsByTagName("w:pStyle")[0] || { getAttribute: () => "" }).getAttribute("w:val") || "";
                const num = child.getElementsByTagName("w:numPr")[0];
                if (!text.trim()) continue;
                const heading = /^(heading|title|subtitle)\s*(\d)?/i.exec(style.replace(/([a-z])(\d)/i, "$1 $2"));
                if (heading) {
                    listNo = 0;
                    lines.push(`${"#".repeat(Math.min(6, Number(heading[2] || 1)))} ${text}`);
                } else if (num) {
                    const level = Number((num.getElementsByTagName("w:ilvl")[0] || { getAttribute: () => "0" }).getAttribute("w:val") || 0);
                    if (level === 0 && !/bullet/i.test(style)) lines.push(`${++listNo}. ${text}`);
                    else lines.push(`   - ${text}`);
                } else {
                    listNo = 0;
                    lines.push(text);
                }
            } else if (child.nodeName === "w:tbl") {
                for (let tr of Array.from(child.getElementsByTagName("w:tr"))) {
                    const cells = Array.from(tr.getElementsByTagName("w:tc")).map(tc =>
                        Array.from(tc.getElementsByTagName("w:t")).map(t => t.textContent).join("").trim());
                    if (cells.some(Boolean)) lines.push(cells.join(" | "));
                }
            } else if (child.childNodes && child.childNodes.length) {
                walk(child);
            }
        }
    };
    walk(body);
    return lines.join("\n");
}

// PowerPoint: one block per slide, in slide order, with speaker notes
async function pptxText(read) {
    const slideNo = n => Number((/(\d+)\.xml$/.exec(n) || [])[1] || 0);
    const slides = read.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNo(a) - slideNo(b));
    const parts = [];
    for (let name of slides) {
        const xml = await read(name);
        const paragraphs = Array.from(parseXml(xml).getElementsByTagName("a:p"))
            .map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join("")).filter(t => t.trim());
        const notes = await read(`ppt/notesSlides/notesSlide${slideNo(name)}.xml`);
        const noteText = notes ? textOfTags(notes, "a:t").join(" ").trim() : "";
        parts.push(`## Slide ${slideNo(name)}\n${paragraphs.join("\n")}${noteText ? `\nNotes: ${noteText}` : ""}`);
    }
    return parts.join("\n\n");
}

// OpenDocument (.odt, .ods, .odp): headings, paragraphs and table rows from content.xml
function odfText(xml) {
    const doc = parseXml(xml);
    const lines = [];
    const walk = node => {
        for (let child of Array.from(node.childNodes)) {
            const n = child.nodeName;
            if (n === "text:p" || n === "text:h") {
                if (child.textContent.trim()) lines.push(child.textContent);
            } else if (n === "table:table-row") {
                const cells = Array.from(child.getElementsByTagName("table:table-cell")).map(c => c.textContent.trim());
                if (cells.some(Boolean)) lines.push(cells.filter(Boolean).join(" | "));
            } else if (n === "draw:page") {
                lines.push(`## ${child.getAttribute("draw:name") || "Slide"}`);
                walk(child);
            } else if (child.childNodes && child.childNodes.length) {
                walk(child);
            }
        }
    };
    walk(doc.documentElement);
    return lines.join("\n");
}

async function xlsxText(buffer) {
    const sheets = await readWorkbookSheets(buffer);
    return sheets.map(s => `## Sheet: ${s.name}\n` + s.rows.map(r => r.values.filter(Boolean).join(" | ")).filter(Boolean).join("\n")).join("\n\n");
}

// RTF → plain text
function rtfText(rtf) {
    return rtf
        // Drop font, colour and style tables, document info and hidden {\* …} groups
        .replace(/\{\\(fonttbl|colortbl|stylesheet|info|\*)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "")
        .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
        .replace(/\\(par|line)\b ?/g, "\n")
        .replace(/\\tab\b ?/g, "\t")
        .replace(/\\[a-z]+-?\d* ?/gi, "")
        .replace(/[{}]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function decodeQuotedPrintable(text) {
    return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToText(html) {
    return new DOMParser().parseFromString(html, "text/html").body.innerText || "";
}

// Email (.eml): headers, text body and image attachments
async function emlSources(text, name) {
    const out = [];
    const bodyText = [];
    const header = text.split(/\r?\n\r?\n/)[0];
    const pick = h => ((new RegExp(`^${h}:\\s*(.+)$`, "im")).exec(header) || [])[1] || "";
    const boundary = (/boundary="?([^";\r\n]+)"?/i.exec(text) || [])[1];
    const parts = boundary ? text.split("--" + boundary).slice(1, -1) : [text.slice(header.length)];
    for (let part of parts) {
        const [head, ...rest] = part.replace(/^\r?\n/, "").split(/\r?\n\r?\n/);
        let body = rest.join("\n\n");
        const type = ((/content-type:\s*([^;\r\n]+)/i.exec(head) || [])[1] || "text/plain").toLowerCase();
        const enc = ((/content-transfer-encoding:\s*([^\r\n]+)/i.exec(head) || [])[1] || "").toLowerCase();
        const filename = (/(?:file)?name="?([^";\r\n]+)"?/i.exec(head) || [])[1];
        if (type.startsWith("image/") && enc.includes("base64") && out.length < MAX_EMBEDDED_IMAGES) {
            const bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), c => c.charCodeAt(0));
            try { out.push({ ...(await prepareImage(new Blob([bytes], { type }))), label: filename || "attachment" }); } catch (e) { /* skip */ }
            continue;
        }
        if (enc.includes("base64")) { try { body = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s+/g, "")), c => c.charCodeAt(0))); } catch (e) { continue; } }
        if (enc.includes("quoted-printable")) body = decodeQuotedPrintable(body);
        if (type === "text/plain") bodyText.push(body.trim());
        else if (type === "text/html" && !bodyText.length) bodyText.push(htmlToText(body).trim());
    }
    return [{
        ...sourceBase(name, text.length), kind: "text",
        text: `From: ${pick("From")}\nTo: ${pick("To")}\nDate: ${pick("Date")}\nSubject: ${pick("Subject")}\n\n${bodyText.join("\n\n")}`,
        images: out,
    }];
}

// Does this look like text? (no NUL bytes, few control characters)
function looksLikeText(bytes) {
    const sample = bytes.subarray(0, 8192);
    if (sample.length >= 2 && ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff))) return true;
    let control = 0;
    for (let b of sample) {
        if (b === 0) return false;
        if (b < 9 || (b > 13 && b < 32)) control++;
    }
    return control / Math.max(1, sample.length) < 0.02;
}

function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
    return new TextDecoder().decode(bytes);
}

// Old binary formats (.doc, .xls, .ppt, .msg …): readable runs of ASCII and UTF-16 text
function binaryStrings(bytes) {
    const runs = [];
    let ascii = "";
    for (let b of bytes) {
        if (b >= 32 && b < 127) ascii += String.fromCharCode(b);
        else { if (ascii.length >= 5) runs.push(ascii); ascii = ""; }
    }
    if (ascii.length >= 5) runs.push(ascii);
    // UTF-16LE (Word, PowerPoint, Outlook): readable characters only, at both byte alignments
    const printable = c => (c >= 32 && c < 127) || (c >= 160 && c < 0x250) || (c >= 0x2010 && c < 0x2070) || c === 10 || c === 13 || c === 9;
    for (let start = 0; start < 2; start++) {
        let wide = "";
        for (let i = start; i + 1 < bytes.length; i += 2) {
            const code = bytes[i] | (bytes[i + 1] << 8);
            if (printable(code)) wide += String.fromCharCode(code);
            else { if (wide.trim().length >= 5) runs.push(wide); wide = ""; }
        }
        if (wide.trim().length >= 5) runs.push(wide);
    }
    const seen = new Set();
    // Keep runs that read like words, not binary noise
    return runs.map(r => r.trim())
        .filter(r => /[A-Za-z]{3,}/.test(r) && (r.match(/[A-Za-z ]/g) || []).length / r.length > 0.6 && !seen.has(r) && seen.add(r))
        .join("\n").slice(0, MAX_TEXT_CHARS);
}

function textSource(name, size, text, extra = {}) {
    const clipped = (text || "").length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) + "\n…(truncated)" : (text || "");
    return { ...sourceBase(name, size), kind: "text", text: clipped, ...extra };
}

// Zip-based files: Office, OpenDocument, or a plain archive of anything
async function zipSources(bytes, name, depth) {
    const read = await readZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const has = n => read.names.includes(n);
    const ext = extOf(name);

    // Office and OpenDocument files: one source with the text and the screenshots inside it
    if (has("word/document.xml")) {
        return [textSource(name, bytes.length, docxXmlText(await read("word/document.xml")), { images: await embeddedImages(read, "word/media/"), docType: "Word document" })];
    }
    if (read.names.some(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
        const slides = read.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
        return [textSource(name, bytes.length, await pptxText(read), { images: await embeddedImages(read, "ppt/media/"), docType: "PowerPoint", slides })];
    }
    if (has("xl/workbook.xml")) {
        return [textSource(name, bytes.length, await xlsxText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), { docType: "Excel workbook" })];
    }
    if (has("content.xml") && /^od[tspg]$|^ot[tsp]$/.test(ext)) {
        return [textSource(name, bytes.length, odfText(await read("content.xml")), { images: await embeddedImages(read, "Pictures/"), docType: "OpenDocument" })];
    }
    // Any other archive: one source holding every file inside (one level of nested archives)
    if (depth > 1) return [{ ...sourceBase(name, bytes.length), kind: "other", note: "nested archive — unzip it and upload the files" }];
    const children = [];
    for (let entry of read.names.filter(n => !n.endsWith("/") && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(n)).slice(0, 200)) {
        const data = await read.bytes(entry);
        if (!data || !data.length) continue;
        const inner = new File([data], entry.split("/").pop(), { type: MIME_BY_EXT[extOf(entry)] || "" });
        try {
            for (let s of await readSources(inner, depth + 1)) children.push({ ...s, name: entry });
        } catch (e) {
            children.push({ ...sourceBase(entry, data.length), kind: "other", note: e.message });
        }
    }
    if (!children.length) return [{ ...sourceBase(name, bytes.length), kind: "other", note: "the archive is empty" }];
    return [{ ...sourceBase(name, bytes.length), kind: "archive", children }];
}

// PDF text for the offline generator (pdf.js, loaded only when a PDF is uploaded). Claude reads the PDF itself.
let pdfJsPromise = null;
function loadPdfJs() {
    if (!pdfJsPromise) {
        pdfJsPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = () => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                resolve(window.pdfjsLib);
            };
            script.onerror = () => reject(new Error("PDF reader could not be loaded"));
            document.head.appendChild(script);
        });
    }
    return pdfJsPromise;
}

async function pdfText(bytes) {
    try {
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
        const pages = [];
        for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
            const content = await (await doc.getPage(i)).getTextContent();
            let line = "";
            const lines = [];
            for (let item of content.items) {
                line += item.str;
                if (item.hasEOL) { lines.push(line); line = ""; }
            }
            if (line) lines.push(line);
            pages.push(lines.join("\n"));
        }
        return pages.join("\n\n").slice(0, MAX_TEXT_CHARS);
    } catch (e) {
        return "";                                         // offline or scanned PDF: AI still reads the file
    }
}

// Any file → one or more sources
async function readSources(file, depth = 0, onProgress = () => {}) {
    const name = file.name;
    const ext = extOf(name);
    const type = file.type || "";

    if (type.startsWith("video/") || VIDEO_EXT.test(name)) return await videoFrames(file, onProgress);
    if (type.startsWith("image/") || IMAGE_EXT.test(name)) return [await imageSource(file, name)];
    if (type.startsWith("audio/") || AUDIO_EXT.test(name)) {
        return [{ ...sourceBase(name, file.size), kind: "other", note: "audio can't be read — add a short summary to the test basis" }];
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

    if (isPdf || type === "application/pdf" || ext === "pdf") {
        if (file.size > MAX_PDF_BYTES) throw new Error("PDF is larger than 25 MB — split it or upload the relevant pages.");
        return [{ ...sourceBase(name, file.size), kind: "pdf", mime: "application/pdf", data: base64Of(await fileToDataUrl(file)), text: await pdfText(bytes) }];
    }
    if (isZip) return await zipSources(bytes, name, depth);

    if (looksLikeText(bytes)) {
        const text = decodeText(bytes);
        if (ext === "rtf" || text.startsWith("{\\rtf")) return [textSource(name, file.size, rtfText(text))];
        const mailHeaders = /^(received|return-path|mime-version|delivered-to|message-id):/im.test(text.slice(0, 2000));
        if (ext === "eml" || (!ext || ext === "msg") && mailHeaders) return await emlSources(text, name);
        if (/^html?$|^xhtml$|^mht(ml)?$/.test(ext) || /^\s*<!doctype html|^\s*<html/i.test(text)) return [textSource(name, file.size, htmlToText(text))];
        return [textSource(name, file.size, text)];
    }

    // Binary we can't parse fully (.doc, .xls, .ppt, .msg, …): keep the readable text
    const strings = binaryStrings(bytes);
    if (strings.replace(/\s/g, "").length >= 40) {
        return [textSource(name, file.size, strings, { note: "text extracted from a binary file — formatting is lost" })];
    }
    return [{ ...sourceBase(name, file.size), kind: "other", note: `no readable text found in this .${ext || "file"} — export it as PDF, DOCX or images` }];
}

function formatSize(bytes) {
    return bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

// ---------- Setup card UI ----------

function renderSources() {
    const list = $("sourceList");
    if (!list) return;
    const total = Sources.bytes();
    $("sourceSummary").textContent = Sources.list.length ? Sources.summary() : "No files yet";
    $("sourceSummary").title = Sources.list.length ? `About ${formatSize(total)} to send with each Smart request` : "";
    list.innerHTML = Sources.list.map(s => {
        const thumb = s.kind === "image" ? s : (s.images || [])[0] || (s.children || []).map(c => c.kind === "image" ? c : (c.images || [])[0]).find(Boolean);
        const ext = extOf(s.name);
        const images = Sources.imageCount(s) - (s.kind === "image" ? 1 : 0);
        const meta = s.kind === "other" ? `<span class="warn">Not readable — ${escapeHtml(s.note)}</span>` : [
            s.kind === "image" ? `Screenshot · ${s.width}×${s.height}` : "",
            s.kind === "video" ? `Recording${s.duration ? " · " + formatTime(s.duration) : ""} · ${images} screen${images === 1 ? "" : "s"} · ${(s.images || []).filter(i => (i.note || "").trim()).length} noted` : "",
            s.kind === "archive" ? `ZIP · ${s.children.length} file${s.children.length === 1 ? "" : "s"}` : "",
            s.kind === "pdf" ? `PDF${s.text ? ` · ${s.text.length.toLocaleString()} chars of text` : ""}` : "",
            s.kind === "text" ? `${s.docType || "Text"}${s.slides ? ` · ${s.slides} slide${s.slides === 1 ? "" : "s"}` : ""} · ${(s.text || "").length.toLocaleString()} chars` : "",
            images && s.kind !== "video" ? `${images} screen${images === 1 ? "" : "s"}` : "",
            formatSize(s.size),
        ].filter(Boolean).join(" · ");
        return `
        <div class="source ${s.kind === "other" ? "unreadable" : ""}" title="${escapeHtml(s.name)}${s.note ? " — " + escapeHtml(s.note) : ""}">
            ${thumb
                ? `<span class="source-thumb-wrap" data-preview="${s.id}"><img src="data:${thumb.mime};base64,${thumb.data}" alt="" class="source-thumb">${s.kind !== "image" ? `<span class="source-ext ext-${escapeHtml(ext)}">${s.kind === "video" ? "▶" : escapeHtml(ext.slice(0, 4).toUpperCase())}</span>` : ""}</span>`
                : `<span class="source-icon ${s.kind} ext-${escapeHtml(ext)}">${s.kind === "pdf" ? "PDF" : s.kind === "other" ? "!" : (ext || "TXT").slice(0, 4).toUpperCase()}</span>`}
            <span class="source-text">
                <span class="source-name">${escapeHtml(s.name)}</span>
                <span class="source-meta">${meta}</span>
            </span>
            ${s.kind === "video" ? `<button type="button" class="btn btn-sm" data-video-open="${s.id}" title="Watch the recording and note what happens on each screen">View</button>` : ""}
            ${(s.text || "").trim() ? `<button type="button" class="icon-btn" data-source-append="${s.id}" title="Copy the text into the test basis" aria-label="Copy into test basis">⇣</button>` : ""}
            <button type="button" class="icon-btn danger" data-source-remove="${s.id}" title="Remove" aria-label="Remove ${escapeHtml(s.name)}">✕</button>
        </div>`;
    }).join("") +
        (total > REQUEST_BUDGET ? `<p class="source-warn">These files total about ${formatSize(total)} — more than one Smart request can carry (about ${formatSize(REQUEST_BUDGET)}). Remove some, or the last ones are skipped.</p>` : "");
    $("clearSourcesBtn").hidden = !Sources.list.length;
    if ($("sourcesPanel")) $("sourcesPanel").hidden = !Sources.list.length;
    $("dropZone").classList.toggle("compact", Sources.list.length > 0);
    if (typeof renderBasisStats === "function" && $("basisStats")) renderBasisStats();
    if (typeof Chat !== "undefined" && Chat.input) Chat.renderMode();
}

async function handleSourceFiles(files) {
    if (!files || !files.length) return;
    const zone = $("dropZone");
    const label = zone.querySelector("strong");
    const original = label.textContent;
    zone.classList.add("busy");
    const { added, failed, notes } = await Sources.addFiles(Array.from(files), text => { label.textContent = text; });
    label.textContent = original;
    zone.classList.remove("busy");
    renderSources();
    renderGenerateHint();
    const readable = added.filter(s => s.kind !== "other").length;
    if (failed.length) App.toast("Not added — " + failed.join("; "));
    else if (notes.length && !readable) App.toast("Added, but these can't be read: " + notes.join("; "));
    else if (added.length) App.toast(`Added ${added.length} source${added.length === 1 ? "" : "s"}${notes.length ? ` (${notes.length} not readable)` : ""}. Select Generate test cases when you're ready.`);
    else App.toast("Those files are already in the list.");
}

function initSourcesUi() {
    const zone = $("dropZone");
    const input = $("sourceInput");
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { handleSourceFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", e => handleSourceFiles(e.dataTransfer.files));

    // Paste screenshots straight from the clipboard while on Setup
    document.addEventListener("paste", e => {
        if (App.state.tab !== "setup" || e.target.closest("input, textarea, [contenteditable]")) return;
        const files = Array.from(e.clipboardData.files || []);
        if (files.length) {
            e.preventDefault();
            handleSourceFiles(files.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted-screen-${Date.now()}-${i + 1}.png`, { type: f.type })));
        }
    });

    $("sourceList").addEventListener("click", async e => {
        const remove = e.target.closest("[data-source-remove]");
        if (remove) {
            await Sources.remove(remove.dataset.sourceRemove);
            renderSources();
            renderGenerateHint();
            return;
        }
        const append = e.target.closest("[data-source-append]");
        if (append) {
            const s = Sources.list.find(x => x.id === append.dataset.sourceAppend);
            App.state.basisText = ((App.state.basisText || "").trim() + `\n\n# ${s.name}\n${s.text}`).trim();
            App.save();
            fillBindings($("s-basis"));
            renderBasisStats();
            App.toast(`Copied ${s.name} into the test basis.`);
            return;
        }
        const video = e.target.closest("[data-video-open]") || (() => {
            const p = e.target.closest("[data-preview]");
            return p && (Sources.list.find(x => x.id === p.dataset.preview) || {}).kind === "video" ? p : null;
        })();
        if (video) { VideoViewer.open(video.dataset.videoOpen || video.dataset.preview); return; }
        const preview = e.target.closest("[data-preview]");
        if (preview) {
            // Every image in that file (screenshot, slides, video frames, archive contents)
            const s = Sources.list.find(x => x.id === preview.dataset.preview);
            const imgs = Sources.flat([s]).flatMap(x => [...(x.kind === "image" ? [{ ...x, label: x.name }] : []), ...(x.images || [])]);
            const w = window.open();
            if (w) w.document.write(`<title>${escapeHtml(s.name)}</title><body style="font-family:sans-serif;margin:16px;background:#f5f6fa">
                <h3>${escapeHtml(s.name)} — ${imgs.length} image${imgs.length === 1 ? "" : "s"}</h3>
                ${imgs.map(i => `<figure style="margin:0 0 18px"><img src="data:${i.mime};base64,${i.data}" style="max-width:100%;border:1px solid #ddd"><figcaption style="color:#666;font-size:13px">${escapeHtml(i.label || "")}</figcaption></figure>`).join("")}</body>`);
        }
    });

    $("clearSourcesBtn").addEventListener("click", async () => {
        if (!confirm(`Remove all ${Sources.list.length} uploaded files?`)) return;
        await Sources.clear();
        renderSources();
        renderGenerateHint();
    });
}

// ---------- Fill the required Setup parameters from the sources (Smart) ----------

const STR_FIELD = { type: "string" };
const SETUP_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "project_name", "prefix", "file_name", "scope", "change_areas", "surfaces", "modules", "default_precondition", "test_data", "open_questions", "basis_notes"],
    properties: {
        summary: STR_FIELD,
        project_name: STR_FIELD,
        prefix: STR_FIELD,
        file_name: STR_FIELD,
        scope: { type: "string", enum: ["changed", "ui", "full"] },
        change_areas: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["area", "type"], properties: { area: STR_FIELD, type: { type: "string", enum: ["NEW", "EXISTING-REVAMPED"] } } },
        },
        surfaces: { type: "array", items: { type: "string", enum: ["Time Clock device", "Manager web", "Settings", "Reports", "Mobile app"] } },
        modules: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["code", "name", "title"], properties: { code: STR_FIELD, name: STR_FIELD, title: STR_FIELD } },
        },
        default_precondition: STR_FIELD,
        test_data: {
            type: "array",
            items: {
                type: "object", additionalProperties: false, required: ["category", "item", "value", "notes"],
                properties: { category: { type: "string", enum: ["Environment", "Users", "Configuration", "Schedule", "Records", "Reports", "Boundary"] }, item: STR_FIELD, value: STR_FIELD, notes: STR_FIELD },
            },
        },
        open_questions: { type: "array", items: STR_FIELD },
        basis_notes: STR_FIELD,
    },
};

// Smart: read text and screenshots, then fill every required Setup parameter of the standard. Returns true when applied.
async function analyseSourcesWithAi() {
    const buttons = ["generateBtn", "generateBtn2"].map(id => $(id)).filter(Boolean);
    const originals = buttons.map(b => b.innerHTML);
    buttons.forEach(b => { b.disabled = true; b.classList.add("loading"); b.innerHTML = "Reading your files…"; });
    try {
        const result = await claudeJson({
            schema: SETUP_SCHEMA,
            effort: "high",
            sources: true,
            instruction: `Read the uploaded sources (release notes, documents, slides, screenshots, recording frames) and the test basis text, then fill the Setup of a new test case workbook exactly as the standard requires.
- project_name: "<Product> — <Enhancement name>", e.g. "Zip Clock — Shift Close Workflow".
- prefix: 2-6 capital letters for the enhancement (use a "Short code" from the sources when given; e.g. SCW, PACK, CIO, UPS).
- file_name: the enhancement name with underscores plus .xlsx, e.g. "Shift_Close_Workflow.xlsx".
- scope: "changed" unless the sources ask for the full module.
- change_areas: each changed screen or flow, marked NEW or EXISTING-REVAMPED from the sources (revamp, redesign, moved, replaces → EXISTING-REVAMPED).
- surfaces: only those the sources show.
- modules: functional modules in flow order, codes ONLY from: ${Object.keys(MODULE_NAMES).filter(c => !TAIL_SECTIONS[c]).join(", ")} (never RPT, REG, EDG, API, DB, INT). name = short dashboard name; title = banner title. Use CFG when settings change.
- default_precondition: the device or web state before step 1 for most cases, with the concrete site and employee from the sources.
- test_data: Users, Configuration, Schedule, Records and Boundary items the cases will need, with concrete values seen in the sources (employee names, job codes, times, reasons, report names); add Environment "Site" when the sources name one. Placeholder values are allowed only with a note saying "Placeholder: confirm …".
- basis_notes: a test-basis write-up of what the sources show — settings, flows step by step, exact UI labels and messages exactly as they appear on the screens. Be complete and literal.
- open_questions: behaviours the sources do not settle (flag off states, fallbacks, limits).
- summary: one or two sentences for the tester.`,
        });
        if (result.error) { App.toast(result.error); return false; }
        applySetupProposal(result.data);
        return true;
    } finally {
        buttons.forEach((b, i) => { b.innerHTML = originals[i]; b.classList.remove("loading"); b.disabled = false; });
        renderSources();
    }
}

function applySetupProposal(d) {
    const s = App.state;
    const p = s.project;
    if (!p.name.trim()) p.name = d.project_name;
    if (!p.code.trim()) p.code = (d.prefix || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (!(p.fileName || "").trim()) p.fileName = d.file_name;
    p.infix = (SCOPES[d.scope] || SCOPES.changed).infix;
    if (!p.basePre.trim() && d.default_precondition) p.basePre = d.default_precondition;
    s.scope = d.scope || s.scope;
    if (!s.changeAreas.some(a => a.area.trim()) && d.change_areas.length) s.changeAreas = d.change_areas;
    if (!s.surfaces.length) s.surfaces = d.surfaces;
    const hasModules = s.modules.some(m => m.code.trim());
    if (!hasModules && d.modules.length) {
        s.modules = d.modules
            .filter(m => MODULE_NAMES[m.code.toUpperCase()] && !TAIL_SECTIONS[m.code.toUpperCase()])
            .map(m => ({ ...EMPTY_MODULE, code: m.code.toUpperCase(), name: m.name, description: m.title }));
        if (!s.modules.length) s.modules = [{ ...EMPTY_MODULE }];
    }
    // Test Data in the standard categories; Environment rows only update an existing standard row
    for (let item of d.test_data || []) {
        if (!item.item || !item.value) continue;
        const existing = s.data.find(x => x.item.toLowerCase() === item.item.toLowerCase());
        if (existing) { if (item.category !== "Environment" || /^site$/i.test(item.item)) Object.assign(existing, item); }
        else if (item.category !== "Environment") s.data.push({ ...item });
    }
    const questions = d.open_questions.length ? "\n\n## Open questions (to confirm)\n" + d.open_questions.map(q => "- " + q).join("\n") : "";
    // What Smart read from the files: kept apart from the tester's own details and replaced on every Generate
    s.smartNotes = `# Test basis read from the uploaded files\n${d.basis_notes}${questions}`;
    App.save();
    renderCounts();
    Chat.push("assistant", `${d.summary}\n\nFound in your files: ${s.modules.map(m => m.code).filter(Boolean).join(", ")} + RPT, REG, EDG · ${(d.test_data || []).length} Test Data items · ${d.open_questions.length} open question${d.open_questions.length === 1 ? "" : "s"}. Writing the cases now, one module at a time.`, "ai");
}