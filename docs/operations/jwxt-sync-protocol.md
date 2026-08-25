# JWXT periodic sync protocol gate

Current conclusion: **unverified**. The repository contains a fixture-verified Node adapter and collector, but no authorized `production` Environment credentials were available while implementing issue #611, so neither a local real-account probe nor a GitHub-hosted pilot has been claimed as `supported`.

The manual `pilot` path executes:

1. prepare the eHall auth-adapter service;
2. perform a fresh CAS password login for that service (never reuse the site's `jufexk_user_session`);
3. exchange the service ticket into an eHall session;
4. launch the fixed undergraduate JWXT app and exchange its service ticket;
5. retain the JWXT `JSESSIONID` in process memory only;
6. discover the selected default term and query `DataTable.jsp` serially with GBK decoding, bounded retries and pacing;
7. write only the redacted capture contract consumed by `scripts/jwxt-sync/run.ts`.

CAPTCHA and interactive MFA produce an explicit `unsupported` failure. Other protocol changes, blocked GitHub egress, missing tickets/cookies, pagination changes and malformed pages produce a failed run; none can be converted to an empty published generation. Full and resume modes checkpoint redacted rows after every page, and `resume` requires the R2 checkpoint to match the newly discovered query matrix.

To decide the gate, configure `JWXT_USERNAME` and `JWXT_PASSWORD` in the GitHub `production` Environment, leave `JWXT_SYNC_ENABLED=false`, and manually dispatch `Periodic JWXT sync` in `pilot` mode. Inspect only the step status and redacted row count. Do not upload or paste logs containing upstream bodies, redirects, cookies, tickets, capacity or enrollment counts. Set `JWXT_SYNC_ENABLED=true` only after the pilot publishes a valid staging generation, uploads its redacted R2 package, atomically switches D1, and the public schedule query shows no private fields.

