#!/usr/bin/env bash
set -euo pipefail

# Official recommended set from mattpocock/skills plugin.json (not deprecated extras).
npx --yes skills@latest add https://github.com/mattpocock/skills.git \
  -g \
  -a cursor \
  --copy \
  -y \
  --skill \
  ask-matt \
  code-review \
  codebase-design \
  diagnosing-bugs \
  domain-modeling \
  grill-with-docs \
  implement \
  improve-codebase-architecture \
  prototype \
  research \
  resolving-merge-conflicts \
  setup-matt-pocock-skills \
  tdd \
  to-spec \
  to-tickets \
  triage \
  wayfinder \
  wizard \
  grill-me \
  grilling \
  handoff \
  teach \
  to-questionnaire \
  wait-what \
  writing-for-agents
