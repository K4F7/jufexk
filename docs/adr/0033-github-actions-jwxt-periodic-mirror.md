# GitHub Actions publishes a disabled-by-default periodic JWXT mirror

Issue [#611](https://github.com/K4F7/jufexk/issues/611) deliberately changes ADR-0029's “no public offering mirror” decision. An isolated production GitHub Actions workflow may authenticate to fixed CAS/eHall/JWXT endpoints, collect and redact source data, retain compressed checkpoints in R2, stage it in D1, and atomically publish an active generation; the Worker only queries published D1 rows and never crawls JWXT. This remains disabled until an authorized GitHub-hosted pilot proves the complete protocol and leakage controls.

The mirror is independent from `offerings` and `reviews.offering_id`. Class number is a private source identity and enrollment capacity/counts are discarded before R2 or D1 publication; the anonymous schedule projection returns only an opaque key, course, teacher, term, campus, weeks, time and place. A partial or failed capture cannot change the active generation, and an offering becomes offline only after two complete full generations omit it.

## Consequences

- `production` Environment owns the CAS credentials and `JWXT_SYNC_ENABLED` gate. PR/fork events cannot invoke the workflow, and it is not part of `CI / check`.
- A `supported` pilot is operational evidence, not something fixtures can assert. GitHub egress rejection, CAPTCHA, or unsupported MFA must end as an explicit failure rather than an empty generation.
- R2 is audit/checkpoint storage; D1 is the query model. Actions artifacts must not retain JWXT data.
