#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_state_dirs

cat >"${PROFILE_PROMOTION_NOTES}" <<EOF
# Accepted Idea Delivery Stage Handoff Notes

Session manifest:
- ${SESSION_FILE}

Generic promotion report:
- ${PROMOTION_REPORT}

Before governed stage rehearsal:

1. Turn the winning local broker changes into reviewed commits in \`operator-orchestration-service\`.
2. Turn any OpenProject proposal-plane or delivery-plane contract changes into reviewed commits in \`platform-engineering\`.
3. Keep the accepted-idea delivery review artifacts and active profile admission truth aligned in \`security-architecture\` and \`workspace-governance\`.
4. Rebuild immutable governed artifacts instead of promoting this local runtime directly.
5. Rehearse the final candidate on governed stage against the profile-owned checks:
$(stage_handoff_required_checks_markdown)
EOF

cat "${PROMOTION_REPORT}"
echo
cat "${PROFILE_PROMOTION_NOTES}"
