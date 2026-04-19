#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_state_dirs

cat >"${PROFILE_PROMOTION_NOTES}" <<EOF
# Idea Workflow Stage Handoff Notes

Session manifest:
- ${SESSION_FILE}

Generic promotion report:
- ${PROMOTION_REPORT}

Before governed stage rehearsal:

1. Turn the winning local broker changes into reviewed commits in \`operator-orchestration-service\`.
2. Turn any command-surface or Telegram UX changes into reviewed commits in \`openclaw-telegram-enhanced\`.
3. If local OpenProject backlog seeding assumptions changed, formalize them in \`platform-engineering\`.
4. Rebuild immutable governed artifacts instead of promoting this local runtime directly.
5. Rehearse the final candidate on governed stage against the profile-owned checks:
$(stage_handoff_required_checks_markdown)
EOF

cat "${PROMOTION_REPORT}"
echo
cat "${PROFILE_PROMOTION_NOTES}"
