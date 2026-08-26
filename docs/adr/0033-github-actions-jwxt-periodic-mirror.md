# Cloudflare Worker publishes a disabled-by-default periodic JWXT mirror

Issue [#611](https://github.com/K4F7/jufexk/issues/611) deliberately changes ADR-0029's “no public offering mirror” decision. The production Worker may authenticate to fixed eHall/CAS/JWXT endpoints with a browser-exported eHall Cookie, collect and redact source data, retain checkpoints and redacted NDJSON in R2, stage it in D1, and atomically publish an active generation. This remains disabled until an authorized Worker pilot proves the complete protocol and leakage controls.

The mirror is independent from `offerings` and `reviews.offering_id`. Class number is a private source identity and enrollment capacity/counts are discarded before R2 or D1 publication; the anonymous schedule projection returns only an opaque key, course, teacher, term, campus, weeks, time and place. A partial or failed capture cannot change the active generation, and an offering becomes offline only after two complete full generations omit it.

## Consequences

- Worker secrets own `JWXT_EHALL_COOKIE`, `JWXT_SYNC_TRIGGER_SECRET`, and the dashboard `JWXT_SYNC_ENABLED` gate. The eHall Cookie remains in the Worker invocation only and is never returned or logged. The legacy GitHub workflow is manual-only and must not share the schedule.
- A `supported` pilot is operational evidence, not something fixtures can assert. Upstream egress rejection, CAPTCHA, unsupported MFA, expired cookies, or protocol changes must end as an explicit failure rather than an empty generation.
- R2 is audit/checkpoint storage; D1 is the query model. The Worker path does not write raw upstream HTML, cookies, tickets, enrollment fields, or raw class numbers.
- The executable protocol and gate procedure are recorded in `docs/operations/jwxt-sync-protocol.md`; until its authorized pilot is run, the operational conclusion remains `unverified` rather than `supported`.
