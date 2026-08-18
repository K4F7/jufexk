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

# Slash menus often scan ~/.cursor/skills, while the installer writes ~/.agents/skills.
if [ -d "${HOME}/.agents/skills" ]; then
  mkdir -p "${HOME}/.cursor/skills"
  for skill_dir in "${HOME}/.agents/skills"/*/; do
    [ -f "${skill_dir}SKILL.md" ] || continue
    name="$(basename "${skill_dir}")"
    rm -rf "${HOME}/.cursor/skills/${name}"
    cp -a "${skill_dir}" "${HOME}/.cursor/skills/${name}"
  done
fi
