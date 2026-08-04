# AGENTS.md — nan-alibi

이 프로젝트의 단일 진실 공급원은 [CLAUDE.md](CLAUDE.md)다.
Codex / Gemini / Cursor 등 모든 에이전트는 CLAUDE.md의 세션 루틴을 그대로 따른다 (파일명과 무관하게 내용은 에이전트 중립이다).

주의: Claude Code 훅(STATE 자동 주입, 종료 시 갱신 체크)은 Claude 전용이다. 다른 에이전트는 루틴을 스스로 지켜야 한다 — **특히 세션 종료 시 `docs/journal/` append + `docs/STATE.md` 갱신을 빠뜨리지 마라.**
