AMPReM FINAL UPDATE

File placement:
- index.html              -> Netlify site root
- style.css               -> Netlify site root (preserves old cream/olive CSS + gate/modal styles)
- script.js               -> Netlify site root
- admin.html              -> Netlify site root (open /admin.html)
- netlify/functions/amprem.js -> Netlify Functions folder

Before deploying:
1. Keep AMPReM_ADMIN_KEY in Netlify Environment Variables.
2. Ensure @netlify/blobs is available as a project dependency for the function.
3. Deploy the complete folder/site, not just index.html.
4. Open /admin.html, enter AMPReM_ADMIN_KEY, and generate a PIN.
5. Test in a private/incognito browser with the generated PIN.

Important security note:
The device lock uses a persistent browser token stored in localStorage. This prevents ordinary PIN sharing across separate browser profiles/devices, but it is not hardware-backed device attestation; someone who copies browser storage may be able to copy the token too.
