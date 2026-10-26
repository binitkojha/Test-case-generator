// Local server: serves the app and the Smart service at /.netlify/functions/smart (same path as on Netlify).
//   ANTHROPIC_API_KEY=... node server/dev-server.mjs      → http://localhost:8888
// The key stays in this process's environment; the browser never sees it.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSmartHandler } from "./smart-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8888);
const smart = createSmartHandler();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://localhost:${port}`);
        if (url.pathname === "/.netlify/functions/smart") {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) });
            const response = await smart(request, { ip: req.socket.remoteAddress });
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
        }
        // Static files from the app folder only — never the server folder
        const file = path.normalize(path.join(root, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root) || file.includes(`${path.sep}server${path.sep}`) || file.includes(`${path.sep}netlify${path.sep}`) || /\.env/.test(file)) { res.writeHead(404); res.end(); return; }
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
    } catch (e) {
        res.writeHead(404); res.end();
    }
}).listen(port, () => console.log(`Test Case Generator on http://localhost:${port} — Smart ${process.env.ANTHROPIC_API_KEY ? "configured" : "not configured (Offline works)"}`));
