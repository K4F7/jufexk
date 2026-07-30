# Catalog Baseline Pilot Report

Generated from the validated, gitignored raw package; no raw course or teacher values are copied into this report or its fixtures.

## Result

**Decision: proceed to full capture.** All mandatory Pilot acceptance checks passed. Boundaries not observed in this Pilot remain explicit gaps for later fixtures; they are not fabricated.

## Package

| Field | Value |
| --- | ---: |
| Batch | `pilot-2026-07-28T16-39-32-453Z` |
| Status | `complete` |
| Queries | 12 |
| Pages | 58 |
| Records | 4685 |
| Bytes | 8372316 |
| Source dictionary SHA-256 | `7d90b36bb84a5391356efcd898dae21bd9732635bce4cc19c0c1c4f1596004d4` |
| Manifest content SHA-256 | `f6965b6a8ab00136379649f2a51cc832ce67ca01dc10a78d45c40ba107e2a7e4` |
| GBK replacement characters | 0 |

## Runtime Audit

- Query statuses: `complete=12`.
- Event counts: `batch_complete=3`, `counterexample_supplemented=1`, `export_complete=4`, `page_complete=58`, `query_complete=12`.
- Counterexample subset check: passed; 4 counterexample queries checked.
- Education-level comparison: 4/4 paired result sets were identical. This is recorded as source behavior, not used to prune the required full matrix.
- Validator recomputed the manifest hash, every declared file hash/byte count, continuous page coverage, accumulated record counts, terminal statuses, and the credential/cross-origin safety scan.

## Boundary Fixtures

| Boundary | Status | Fixture | Evidence |
| --- | --- | --- | --- |
| gbk | proven | `gbk.html` | All raw pages decode as GBK without replacement characters. |
| pagination | proven | `pagination.html` | main-2026-0-05-2025 spans 22 pages. |
| rowspan | not_observed | - | No rowspan attribute was present in the Pilot pages. |
| multi-teacher | not_observed | - | No conclusive multi-teacher field was observed. |
| teacher-digit-suffix | proven | `teacher-digit-suffix.html` | A teacher source token with a numeric suffix was observed. |
| course-rename | not_observed | - | No same-code rename was observed. |
| mooc | proven | `mooc.html` | A MOOC/online-open-course token was observed. |
| three-campuses | proven | `three-campuses.html` | 3 distinct non-empty campus values were sampled. |
| empty-field | proven | `empty-field.html` | At least one table row contains an empty cell. |
| abnormal-format | proven | `abnormal-format.html` | A row with an unexpected cell/course shape was observed. |

Summary: 7 proven, 3 not observed. Fixtures are deterministic pseudonyms encoded as GBK. The source package remains only under the gitignored capture directory.

## Security

- No account password, Cookie, Authorization header, access token, refresh token, or session token is present in the validated package.
- The collector does not read browser credential stores and does not submit credentials.
- Fixture cells replace source course codes/names, teacher values, class identifiers, times, and locations with synthetic values.
