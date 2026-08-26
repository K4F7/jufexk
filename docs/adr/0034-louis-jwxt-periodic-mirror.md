# Louis runs the disabled-by-default JWXT mirror pipeline

ADR-0033's Cloudflare Worker and GitHub Actions implementations are archived on `archive/jwxt-worker-gha-2026-08-26` and removed from the production `main` path. The pilot established that Worker egress could not reach eHall, while the Louis host could reach it under a constrained container.

Louis authenticates with a browser-exported eHall Cookie, collects and redacts source data, and invokes the existing sync publisher. The pipeline remains disabled until an authorized real-account pilot succeeds. A partial or failed capture cannot publish an empty generation.

The container is constrained to two CPUs and two GiB of memory and receives all credentials at runtime only.
