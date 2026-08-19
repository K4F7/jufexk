#!/usr/bin/env bash
set -euo pipefail

case "${EVENT_NAME:-}" in
  pull_request)
    git fetch --no-tags --prune origin "${BASE_REF}"
    git diff --name-only --diff-filter=ACDMRT "origin/${BASE_REF}...HEAD"
    ;;
  merge_group)
    git fetch --no-tags --prune origin main
    git diff --name-only --diff-filter=ACDMRT origin/main...HEAD
    ;;
  *)
    if [[ -z "${BEFORE_SHA:-}" || "${BEFORE_SHA}" == "0000000000000000000000000000000000000000" ]]; then
      git diff --name-only --diff-filter=ACDMRT "${HEAD_SHA}^" "${HEAD_SHA}"
    else
      git diff --name-only --diff-filter=ACDMRT "${BEFORE_SHA}" "${HEAD_SHA}"
    fi
    ;;
esac
