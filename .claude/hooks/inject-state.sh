#!/bin/bash
# SessionStart 훅 — STATE.md를 컨텍스트에 자동 주입 (v5 표준)
# --after-compact: 컨텍스트 압축 직후 미기록분 저장 지시 추가
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true

if [ -f docs/STATE.md ]; then
  echo "=== [v5 자동 주입] docs/STATE.md — 세션 세이브 파일 ==="
  cat docs/STATE.md
  echo "=== 주입 끝. 세션 루틴은 CLAUDE.md 참조 ==="
fi

if [ "${1:-}" = "--after-compact" ]; then
  echo ""
  echo "[v5 알림] 방금 컨텍스트가 압축(compact)되었다. 압축 전 대화에 있었지만 아직 파일로 기록되지 않은 것들을 지금 즉시 기록하라:"
  echo "- 내려진 결정 → docs/decisions/ 에 ADR 추가 (버린 대안 포함)"
  echo "- 진행 상황·시도했다 버린 접근 → docs/journal/오늘날짜.md 에 append"
  echo "- 미해결 질문 → docs/QUESTIONS.md 에 추가"
  echo "- docs/STATE.md 를 현재 상태로 갱신"
fi

exit 0
