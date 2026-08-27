# AGENTS.md — FIVE ALIBIS

> 이 파일은 **에이전트가 이 저장소에서 일하기 위해 알아야 할 전부**다.
> 사람용 서술은 [README.md](README.md), 결정 이력은 `docs/decisions/`(ADR 30편), 현재 상태는 `docs/STATE.md`.

---

## 0. 이 게임이 무엇인가

**LLM이 용의자 5명을 연기하고, 플레이어는 그들의 말과 객관 기록이 어긋나는 지점을 찾아 범인을 지목한다.**
브라우저에서 링크만으로 돌아가는 3D 추리 게임. 한국어.

플레이: https://nan-alibi.pages.dev/?case=gc001

**설계의 한 줄:**

> **AI는 연기하고, 사건의 진실과 승패 판정은 코드가 소유한다.**

이 문장이 이 저장소의 헌법이다. 아래 §2의 불변식은 전부 여기서 파생된다.

---

## 1. 스택과 명령

| | |
|---|---|
| 언어·번들 | TypeScript (strict) · Vite |
| 3D | three.js (GLB + Draco, 디코더는 `/draco/` 자체 호스팅 — 외부 CDN 의존 0) |
| 서버 | Cloudflare Pages Functions (`functions/api/`) |
| 테스트 | Vitest — **314건 / 23파일** |

```bash
npm ci
npm run dev        # http://localhost:5181/?case=gc001
npm test           # vitest
npm run verify     # test + functions 타입체크 + tsc --noEmit + build  ← pre-commit 훅이 이걸 강제한다
npm run build
```

**`npm run dev`(vite)에는 Cloudflare Functions가 없다.** `/api/interrogate`가 404 → 폴백 대사로 떨어진다.
AI 응답까지 로컬에서 보려면 `.dev.vars`에 키를 넣고 `npm run cf:dev`.

---

## 2. 깨뜨리면 안 되는 불변식 7

이걸 어기는 변경은 **되돌려야 하는 변경**이다. 리팩토링이 이 중 하나라도 건드리면 멈추고 보고하라.

1. **AI에게 진실을 주지 않는다.** 프롬프트에는 그 용의자의 *주장(claim)* 만 들어간다.
   *진실(truth)* 은 절대 넣지 않는다. — `src/engine/prompt.ts`
2. **거짓말은 AI가 지어내지 않는다.** 누가 언제 거짓말하는지는 시드에서 결정론적으로 고정된다. — `src/engine/caseGen.ts`
3. **LLM 출력은 검증기를 통과해야만 화면에 오른다.** 거부 사유 11종. 실패 시 1회 재요청 → 폴백 →
   **소모한 조사 횟수 환불.** — `src/engine/verify.ts`, `functions/api/interrogate.ts`
4. **채점은 순수 함수다.** 범인 60 · 동기 15 · 도구 15. LLM이 돌려주는 값이 게임 상태로 들어가는 경로는 없다. — `src/engine/game.ts`
5. **`Math.random()` 을 쓰지 않는다.** 같은 시드는 언제나 같은 사건이다. 난수는 시드 파생 스트림만.
6. **시각·장소 라벨은 사건이 소유한다.** 하드코딩 금지 — 반드시 `slotLabel(c, t)` / `placeLabel(c, p)` 를 지난다.
   (호텔은 22:00~22:40, GC-001은 21:00~21:21)
7. **콘텐츠 금칙:** 실제 사건·인물·기관 참조 금지. **수단·신체·유혈 묘사 금지.**

---

## 3. 저장소 지도

```
src/engine/     게임의 알맹이. LLM 호출이 없는 순수 함수 계층
                caseGen 사건생성 · validate 검증기 V1~V7 · solver BFS · game 상태·채점
                prompt 프롬프트 조립 · verify 응답 검증 · bots 밸런스 봇
src/ui/         화면. crimescene3d(30초 현장) · explore3d(경찰서) · stage3d(취조실)
                curtain(막 전환) · cardwall(프로필 카드) · sceneRules(3D 없는 규칙 계층)
src/data/       personas 8종 · config 상수 · gc001 골든 케이스 · pool.json 사전검증 시드 400
functions/api/  interrogate(OpenAI 프록시+검증+폴백) · tts(Supertone) · health(키 유무만)
tests/          vitest 314건
docs/decisions/ ADR 30편 — "무엇을 왜 정했고 무엇을 버렸나"
```

**`sceneRules.ts` 의 존재 이유:** 3D 씬은 headless 테스트가 닿지 않는다. 그래서
**틀리면 자원을 잃는 산수만** 순수 함수로 떼어내 게이트가 보게 했다(시간 상태기계·이동 축·배치·스왑).
3D 관련 로직을 새로 만들 때 **판정 가능한 부분은 여기로 빼라.**

---

## 4. 작업 규율

### 검증 없이 "고쳤다"라고 쓰지 않는다

이 저장소에서 가장 비쌌던 실패는 전부 **검증을 건너뛴 보고**였다.
같은 버그를 세 번 "고쳤다"고 보고한 적이 있고, 원인은 매번 달랐다.

- **버그 수리는 계측 → 수리 → 같은 계측 재실행.** 전/후 수치를 보고에 넣어라. 수치가 없으면 보고하지 마라.
- **3D·타이밍·시각 변경은 브라우저로 직접 확인하라.** 테스트가 안 닿는 구간이다.
- **배포는 커밋이 아니다.** 배포했다면 번들 해시를 대조한 뒤에만 완료라고 말하라.

### 커밋

```
[FIX] 한국어 한 줄 요약        # 제목 72자 이내 (훅이 막는다)
                              # 상세는 본문(-m 두 번째)에. 무엇을 왜, 그리고 버린 대안
```
타입: `FEAT FIX CHORE DOCS REFACTOR TEST PERF WIP` · `git add -A` 금지, 만진 파일만 스테이징.

### 결정을 남긴다

되돌리기 어려운 판단을 했으면 `docs/decisions/NNN-제목.md` 에 ADR을 더한다.
기존 ADR은 수정하지 않는다. **버린 대안을 반드시 함께 적는다.**

---

## 5. 지금 알려진 결함 (손대기 전에 읽어라)

- **칠판이 후보를 자동으로 지운다** — `chalkboard.ts` 가 `candidatesFrom()` 결과로 이름에 분필 줄을
  긋는다. GC-001 에서도 동작하는데, 팀 `Core Loop Migration` 은 "시스템의 자동 후보 제외 제거" 를
  지시한다. **사용자 결정 대기** (`docs/팀원문서-대조-2026-08-27.md` C-1).
- **`src/main.ts` 3,861줄 · `src/ui/crimescene3d.ts` 1,969줄** — 분해 대상. 다만 **테스트가 얇은 구간**이라
  분해 전에 특성 테스트부터 세워야 한다.
- **UI·3D 테스트는 아직 얇다.** 573건 중 대부분이 순수 엔진에 몰려 있다. 다만 드로어·사이드바·
  심문 패널·칠판·씬 규칙·압박 줌은 이제 게이트가 본다.
- **`bakeWalls` 가 `explore3d` 와 `crimescene3d` 두 곳에 중복** 구현돼 있다. DRACOLoader 부트스트랩도 4곳 반복.
- **`/api/interrogate` 에 인증·레이트리밋·Origin 검사가 없다.** 공개 URL이라 제3자가 키를 태울 수 있다.
- 죽은 개발 전용 파일: `casting.html` · `probe-*.html`(4) · `soundlab.html` · `src/casting.ts` · `src/soundlab.ts`

전체 목록은 `docs/STATE.md` 의 "안 되는 것 / 막힌 것".

---

## 6. 리팩토링할 때의 순서

1. **특성 테스트 먼저.** 지금 동작을 그대로 박제하는 테스트를 세운다. 없는 구간을 먼저 분해하지 마라.
2. **한 번에 한 축.** 파일 분해와 동작 변경을 같은 커밋에 섞지 마라.
3. **불변식(§2)을 건드리면 멈추고 보고한다.**
4. 매 단계 `npm run verify` 초록.
