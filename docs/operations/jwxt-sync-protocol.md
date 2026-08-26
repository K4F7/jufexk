# JWXT periodic sync protocol gate

Current conclusion: **unverified**. The repository contains a fixture-verified Worker adapter and collector, but no authorized Worker secret has completed a real-account pilot, so the protocol has not been claimed as `supported`.

The `pilot`, scheduled `incremental`, scheduled `full`, and `resume` paths all discover the selected default term and query `DataTable.jsp` serially with GBK decoding, bounded retries and pacing, then write only the redacted capture contract published by the Worker. Authentication uses the supplied eHall Cookie:

1. with `JWXT_EHALL_COOKIE`, start from the supplied browser eHall `Cookie` header, open the fixed eHall JWXT application, follow the eHall/CAS/JWXT redirects, and retain the resulting JWXT cookies in process memory only;
2. without that secret, fail as `jwxt_cookie_missing`. The Worker never falls back to a password login or a direct JWXT Cookie.

CAPTCHA and interactive MFA produce an explicit `unsupported` failure. Cookie authentication never falls back to a password login and never refreshes itself: a 401 or CAS redirect produces `jwxt_cookie_expired`, so rotate `JWXT_EHALL_COOKIE` and rerun. Other protocol changes, blocked Worker egress, missing tickets/cookies, pagination changes and malformed pages produce a failed run; none can be converted to an empty published generation. Full and resume modes checkpoint redacted rows after every page, and `resume` requires the R2 checkpoint to match the newly discovered query matrix.

To decide the gate, configure `JWXT_EHALL_COOKIE` and `JWXT_SYNC_TRIGGER_SECRET` as Worker secrets, leave dashboard variable `JWXT_SYNC_ENABLED` absent or `false`, then call `POST /internal/jwxt-sync/pilot` with its Bearer trigger secret. Inspect only the status and redacted row count. Do not upload or paste logs containing upstream bodies, redirects, cookies, tickets, capacity or enrollment counts. Set `JWXT_SYNC_ENABLED=true` only after the pilot writes a valid staging generation, uploads its redacted R2 package, and the public schedule query shows no private fields. The scheduled Worker then runs daily incremental and monthly full collection. Rotate the eHall Cookie secret whenever the browser session expires; it is never returned or logged.

For the Louis fallback runner, build `Dockerfile.jwxt-sync` and run the compose service with `docker-compose.jwxt-sync.yml`. The compose limits are `cpus: 2.0`, `mem_limit: 2g`, read-only root, `tmpfs` scratch space, no added capabilities, and no-new-privileges. Inject `EHALL_COOKIE`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` only at runtime through an untracked `.env.jwxt-sync`; never bake them into the image.
