// Netlify Function: POST /.netlify/functions/smart — the Smart service.
// The provider key lives in Netlify environment variables (ANTHROPIC_API_KEY); see SMART_SETUP.md.
import { createSmartHandler } from "../../server/smart-core.mjs";

const handle = createSmartHandler();

export default async (req, context) => handle(req, { ip: context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown" });
