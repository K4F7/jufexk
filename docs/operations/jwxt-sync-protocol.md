# JWXT periodic sync protocol gate

Current conclusion: **unverified**. The Louis runner contains the browser eHall-cookie adapter and fixture-verified JWXT collector. A real-account pilot must be run manually with an authorized, current eHall Cookie.

The runner starts from `EHALL_COOKIE`, follows the fixed eHall/CAS/JWXT redirect chain, discovers the selected term, and queries `DataTable.jsp` serially with bounded retries and pacing. It writes only the redacted capture contract; cookies, tickets, raw HTML, capacity, enrollment counts, and raw class numbers remain in process memory.

Cookie authentication never falls back to password login. An expired or rejected session is an explicit failure and must be rerun with a newly exported eHall Cookie. CAPTCHA, MFA, blocked egress, protocol changes, malformed pages, or incomplete captures must never become an empty generation.

Build and run the constrained Louis container with `Dockerfile.jwxt-sync` and `docker-compose.jwxt-sync.yml`. The compose limits are `cpus: 2.0`, `mem_limit: 2g`, read-only root, tmpfs scratch space, no added capabilities, and no-new-privileges. Inject `EHALL_COOKIE`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` only at runtime through an untracked `.env.jwxt-sync`; never bake them into the image.

To capture a fresh cookie locally, run `pnpm run jwxt-cookie-capture`. The script opens only the eHall home page; the operator handles every login and subsequent navigation manually. It reads the local browser context, waits for the eHall session cookies, and atomically writes `.env.jwxt-sync` without printing or uploading browser state.
