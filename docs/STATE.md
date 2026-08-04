# STATE — nan-alibi (FIVE ALIBIS)

> 덮어쓰는 세이브 파일. 항상 "지금" 기준. 히스토리는 [journal/](journal/), 결정 근거는 [decisions/](decisions/).
> 마지막 갱신: 2026-08-05

## 목표 (이게 되면 끝났다고 말할 수 있는 조건)

**매 판 다른 사건이 생성되고, 5명의 AI 페르소나를 6번의 조사로 심문해 3~5분 안에 범인을 지목하는
브라우저 추리게임을, 2026-08-07 NAN 2026 사전과제로 제출한다.**

끝났다고 말할 수 있는 조건 = 기획서 §6 완료 기준 A~E 전부 통과:
- A. 사건 로직 — 시드 100개 검증 통과율 ≥95%, **최소 조사 수 m\* 가 3~5** (최대 마일스톤)
- B. 게임 규칙 — 조사 6회 예산, 연결 무료, 모순 판정, 채점
- C. AI 계층 — 화이트리스트 검증·폴백 3층·캐시 히트
- D. 성능 — 첫 토큰 ≤1.2s, p95 ≤3.5s, 1판 ≤$0.15, 콘솔 0건
- E. 시간 — 숙련자 1판 ≤5분

**정본 기획서:** `~/Project/NHN/기획/FIVE_ALIBIS_기획서_v1.md` (승인됨 2026-08-05)

## 현재 상태

- 2026-08-05 v5 부트스트랩 (티어: light) — 코드 스캐폴딩 위에 문서 구조만 얹음
- 2026-08-05 **Task 1 완료** — vite+ts+vitest, GitHub Pages 워크플로, Workers 프록시 스텁.
  테스트 2/2, 빌드 성공, `dist` 경로 `./assets/...` 확인. 커밋 `815adee`
- 2026-08-05 GitHub 레포 생성·푸시 (private): https://github.com/teobasaki/nan-alibi
- 2026-08-05 **배포 경로 확정 → Cloudflare Pages 단일 오리진** (ADR 002). `workers/` 제거,
  `functions/api/` 로 전환. CORS 코드 소멸. 테스트 4/4, functions 타입체크·빌드 통과
- 2026-08-05 **Task 2~5 완료 ★ 최대 마일스톤 통과.** 테스트 43/43
  - 시드 고정 RNG(mulberry32) + 코어 타입 + 결정론 사건 생성기 + 검증기 V1~V7 + BFS 해결탐색기
  - **100시드 배치: 원생성 통과율 100%, m\* 분포 3회58/4회42, 범인 S1~S5 전부, 8ms**
  - m\* 고정(전부 3) 문제를 사슬 깊이 가변화로 해결 (ADR 003) + 분산 회귀 감시 추가
- 2026-08-05 **실배포 성공 → https://nan-alibi.pages.dev** (Account `1524bb03...`).
  검증: 게임 200 / `/api/health` `{ok:true,hasKey:false}` / `/api/interrogate` `503 {fallback:true}` /
  CORS 헤더 없음. 배포 파이프라인 종단 확인 완료

## 다음 할 일

- [ ] **Task 6** 게임 상태 리듀서 (조사 예산·카드 인벤토리·보드 연결)
- [ ] **Task 7** 모순 판정기 + 최종 채점
- [ ] **Task 8** 프롬프트 조립 + 구조화 출력 스키마 + 응답 검증기 (LLM 모킹)
- [ ] Task 9~16 (기획서 §11)

## 안 되는 것 / 막힌 것 (정직하게 — "다 잘 됨"이라고 쓰지 마라)

- API는 아직 에코 스텁 — Anthropic 실호출·SSE 중계는 Task 9. 현재 `hasKey:false`
- wrangler 4.x 가 신규 프로젝트에 **Pages 대신 Workers(static assets)** 를 권한다.
  Pages 는 정상 동작하므로 마감 전 전환하지 않는다 — 마감 후 재검토 (ADR 002 에 기록)

## 열린 질문

- [QUESTIONS.md](QUESTIONS.md) 참조
