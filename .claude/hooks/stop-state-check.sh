#!/bin/bash
# Stop 훅 — 작업 변경이 있는데 STATE.md가 안 갱신됐으면 세션당 1회 마무리 요청 (v5 표준)
INPUT="$(cat)"

# 이 훅의 block으로 이미 계속된 상태면 재발동 금지 (무한루프 방지)
echo "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f docs/STATE.md ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

CHANGES="$(git status --porcelain 2>/dev/null || true)"
[ -z "$CHANGES" ] && exit 0                                # 변경 없음 → 통과
echo "$CHANGES" | grep -q "docs/STATE.md" && exit 0        # STATE 이미 손댐 → 통과

# 세션당 1회만 나무란다
SESSION_ID="$(echo "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
MARKER="${TMPDIR:-/tmp}/v5-state-check-${SESSION_ID:-unknown}"
[ -f "$MARKER" ] && exit 0
touch "$MARKER"

cat <<'EOF'
{"decision": "block", "reason": "[v5 루틴] 작업 변경사항이 있는데 docs/STATE.md가 갱신되지 않았다. 마무리 전에 수행하라: (1) docs/journal/오늘날짜.md 에 이번 세션 기록 append (2) 내려진 결정이 있으면 docs/decisions/ 에 ADR 추가 (3) docs/STATE.md 를 현재 상태로 갱신 — '안 되는 것/막힌 것' 포함, 정직하게. 완료 후 다시 종료하라."}
EOF
exit 0
