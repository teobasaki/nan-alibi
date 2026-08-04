# 열린 질문 — nan-alibi

> 답이 나오면 해당 항목을 지우고 `decisions/`에 ADR로 승격한다.

## Q1. 게임 배포 경로 (막힘 — 2026-08-05)

레포가 private이라 GitHub Pages가 안 붙을 수 있다 (무료 플랜은 public repo만 Pages 지원).
심사위원이 URL만 열어 플레이해야 하므로 **반드시 해결해야 하는 항목**이다.

| 선택지 | 장점 | 대가 |
|---|---|---|
| A. 레포를 public으로 전환 | 무료, 즉시 됨, 워크플로 그대로 | 제출 전까지 소스가 공개됨 |
| B. GitHub Pro 구독 | private 유지 | 유료. 단 Pages 사이트 자체는 어차피 공개 URL |
| C. **Cloudflare Pages** | Workers와 **같은 오리진** → CORS 불필요, 무료, private repo 무관 | 배포 설정 1회 추가 |

C가 기술적으로 가장 깔끔하다 (이미 Workers를 쓰므로 계정이 있고, API와 게임이 한 오리진).

## Q2. 팀 2인 분업 경계

기획서 §11 기준 A=엔진(Task 2~7, headless) / B=프록시+프롬프트+UI(Task 8~13) 제안.
`src/orchestrator` 성격 파일과 `style.css`만 소유권이 겹치므로 **append-only** 로 다룬다.
