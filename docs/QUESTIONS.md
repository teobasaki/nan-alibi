# 열린 질문 — nan-alibi

> 답이 나오면 해당 항목을 지우고 `decisions/`에 ADR로 승격한다.

## ~~Q1. 게임 배포 경로~~ → 해결 (2026-08-05)

**Cloudflare Pages 단일 오리진**으로 결정. 근거·버린 대안은 [decisions/002-배포경로-cloudflare-pages.md](decisions/002-배포경로-cloudflare-pages.md).
남은 것은 결정이 아니라 실행: `wrangler login` 최초 1회(사람이 해야 함).

## Q2. 팀 2인 분업 경계

기획서 §11 기준 A=엔진(Task 2~7, headless) / B=프록시+프롬프트+UI(Task 8~13) 제안.
`src/orchestrator` 성격 파일과 `style.css`만 소유권이 겹치므로 **append-only** 로 다룬다.
