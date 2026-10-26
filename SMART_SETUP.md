# Smart service setup

The Test Case Generator works fully without Smart: rule-based generation, validation, the Assistant's
Commands mode and the Excel export need no API key. Smart is optional. It suggests changes that you review
and approve, and it always runs through a server-side function, so the provider key never reaches the browser.

## How it works

1. The app sends a command, the cases in the scope you chose, your format and rules, and only the files that
   command needs. Real e-mail addresses and secrets are removed before sending.
2. The Smart service (`netlify/functions/smart.mjs`) adds the fixed response contract, calls the provider with
   the key from its environment, and returns structured proposals (add, update, delete, suggest).
3. The app validates every proposal against the response schema and the mandatory QA rules
   (`ai-response-validator.js`). Proposals that break a rule are listed separately and cannot be applied.
4. You compare the before and after versions, then tick the changes to apply (`ai-change-review.js`). IDs,
   Test Data mappings and Dashboard counts are recalculated, the whole suite is checked again, and the change
   is saved in History with Undo.

## Deploy on Netlify

1. Deploy the `test-case-generator` folder (it contains `netlify.toml` and `package.json`).
2. Under **Site configuration → Environment variables**, add:

   | Variable | Required | Purpose |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | The provider key. Stored only in Netlify. |
   | `SMART_ACCESS_CODE` | recommended | A team access code. The app asks for it once per tab and never stores it. |
   | `SMART_ALLOWED_ORIGINS` | recommended | Your site's address, e.g. `https://qa-tools.netlify.app`. |
   | `SMART_MODELS` | no | The models people may pick (default `claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5`). |
   | `SMART_RATE_LIMIT` | no | Requests per user IP per 10 minutes (default 30). |
   | `SMART_MAX_BODY_BYTES` | no | Request size limit (default 5000000). |

3. Redeploy. In the app, open **Assistant → Smart → settings (key icon) → Test connection**.

Never put the key in the app's files, in `netlify.toml`, in GitHub, or in a workbook.

## Run locally

```
cd test-case-generator
npm install
set ANTHROPIC_API_KEY=...          (PowerShell: $env:ANTHROPIC_API_KEY="...")
npm run dev                        → http://localhost:8888
```

Opening `index.html` straight from disk still works for everything except Smart. Smart needs the service.

## Tests

`npm run test:smart` checks the service's rules (configuration, access code, origins, rate limit, size
limit, allowed tasks and models, content types, and error handling that never shows the key) with a fake
model. It doesn't call the provider.
