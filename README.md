# AM Prem — Paper Book

## Deploy to Netlify
1. Upload this project folder to a Git repository and import it in Netlify.
2. Build settings: publish directory `.`; functions directory `netlify/functions` (already set in `netlify.toml`).
3. In **Site configuration → Environment variables**, set:
   - `VERIFICATION_API_URL`: HTTPS endpoint for your authorized email-verification provider.
   - `VERIFICATION_API_KEY`: optional bearer key if required by that provider.
   - `ALLOWED_ORIGIN`: optional exact site origin, e.g. `https://your-site.netlify.app`.
4. Redeploy after adding environment variables.

## Provider contract
The configured provider receives a JSON POST:
- Send: `{ "action": "send-magiclink", "email": "person@example.com" }`
- Verify: `{ "action": "verify-account", "email": "person@example.com", "rawLink": "https://..." }`

It must respond with JSON such as `{ "success": true, "message": "..." }`.
This project only relays the verification result. It does not request, store, expose, or forward authentication tokens and does not grant paid subscription entitlements. Use an official provider/API that you are authorized to operate.

## Local preview
Use Node 18+ and Netlify CLI:
`npx netlify dev`
