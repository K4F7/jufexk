# Cloudflare Worker publishes a disabled-by-default periodic JWXT mirror

Issue [#611](https://github.com/K4F7/jufexk/issues/611) deliberately changed ADR-0029's “no public offering mirror” decision. The production Worker was designed to authenticate to fixed eHall/CAS/JWXT endpoints, collect and redact source data, retain checkpoints and redacted NDJSON in R2, stage it in D1, and atomically publish an active generation.

This decision is superseded by ADR-0034 after the production pilot showed that Cloudflare Worker egress could not reach eHall. The complete Worker and GitHub Actions implementation remains available on the archive branch named in ADR-0034.
