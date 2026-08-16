# Catalog Full Capture Summary

## Decision

**Accepted.** The full raw catalog capture is complete, recoverable, auditable, credential-safe, and can be consumed offline. The raw package remains gitignored and is not committed.

## Package

| Field | Value |
| --- | ---: |
| Batch | `full-2026-07-28T17-08-43-840Z` |
| Status | `complete` |
| Queries | 1012 |
| Main matrix queries | 1008 |
| Counterexample queries | 4 |
| Pages | 5340 |
| Records | 445440 |
| Bytes | 791616000 |
| Source dictionary SHA-256 | `7d90b36bb84a5391356efcd898dae21bd9732635bce4cc19c0c1c4f1596004d4` |
| Manifest content SHA-256 | `6420af2ecd7dab615760acdb9ea66ea5fb5ff89eba1e5bee24ed0f63a0333188` |
| GBK replacement characters | 0 |

## Frozen Matrix

- Source dimensions: 21 semesters × 8 education levels × 6 grades = 1008 required main queries.
- Exact Cartesian-product coverage: passed; no missing, duplicate, or extra main dimension tuple.
- Wide-query filters: all blank for every main query.
- Counterexample containment: passed for 4 queries; 1 were non-empty.
- Source dictionary batch-tail check: unchanged; 0 change rounds and 0 unresolved changes.

## Integrity And Runtime Audit

- Query statuses: `complete=1012`.
- Runtime events: `batch_complete=2`, `counterexample_supplemented=1`, `directory_unavailable=2`, `export_complete=1`, `page_complete=5340`, `paused=1`, `query_complete=1012`.
- Checkpoint recovery: 2 directory-unavailable interruptions were followed by terminal completion; page and query completion event counts exactly match the final package, proving completed units were not replayed as an unnecessary full rerun.
- Coverage, checkpoint, queries, and manifest agree on batch ID, query count, terminal statuses, and zero exceptions.
- The validator recomputed the manifest content hash, every declared file byte count and SHA-256, accumulated record count, page count and continuity, query status semantics, and credential/cross-origin safety scan.
- No Cookie, Authorization header, password, access token, refresh token, or session token is present in the validated package.
- All declared source snapshots decode as GBK without replacement characters.

## Storage Boundary

- Raw package: `scripts/catalog-baseline/captures/full` (gitignored, local only).
- This summary contains only aggregate counts and cryptographic hashes; it does not copy course, teacher, class, time, place, or account values.
