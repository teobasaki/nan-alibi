/**
 * GC-001 증명 명제 — **PROP-01 ~ PROP-07** (명세 V0.2 §25·§26).
 *
 * 정본 §16(candidate transition)과 같은 논증을 명제로 옮긴 것이다. Truth 는 바뀌지 않았고,
 * **판정의 기준이 바뀌었다**: "결정적 Evidence 를 골랐는가" → "어떤 명제가 성립했는가".
 *
 * ## 두 경로가 모두 성립해야 한다 (AC-15)
 * ```
 * Proof Path A (Serial 중심)   : 카메라 조각 + REV-17 발급 기록 + 문소라 21:18 위치
 * Proof Path B (권한·위치 중심) : 라벨 교체 + 자격자 둘 + 문소라 21:18 위치 + 이동 시간 2분
 * ```
 * B 에는 `REV-17-084` 가 없다 — 그것을 못 찾아도 사건은 입증된다 (AC-06, §29).
 *
 * ## 근거는 넉넉하게, 결론은 좁게
 * 각 명제의 `supportRules` 는 **여러 줄**이고, 한 줄만 맞아도 성립한다. 같은 사실에 이르는
 * 다른 길을 막지 않기 위해서다 (§28). 반면 범인 축은 두 명제(PROP-05·PROP-06)를 **동시에**
 * 요구한다 — 기회와 은폐 연결이 함께 있어야 입증이다 (§26).
 */

import type { ProofProposition } from '../engine/proof'

export const GC001_PROPOSITIONS: readonly ProofProposition[] = [
  {
    id: 'PROP-01',
    statement: '사건은 단순한 전시물 사고가 아니다.',
    supportRules: [
      // 20:40 정상 확인 + 사건 후 상태 변화 (정본의 그 대조)
      { allOf: ['F-GC001-PLINTH-OK-2040', 'F-GC001-DEATH-CLASSIFICATION'] },
      // 현장 판정 기록 하나로도 분류는 확인된다
      { anyOf: ['E4'] },
      { allOf: ['F-GC001-PLINTH-OK-2040', 'E4'] },
    ],
  },
  {
    id: 'PROP-02',
    statement: '21:18 메인홀에서 누군가 라벨을 교체했다.',
    supportRules: [
      { anyOf: ['E8', 'F-GC001-LABEL-CHANGED-2118'] },
    ],
  },
  {
    id: 'PROP-03',
    statement: '21:18 정식 라벨 변경이 가능한 인물은 둘로 제한된다.',
    supportRules: [
      // Route A — 권한 대장(플레이어 Fact)
      { anyOf: ['F-GC001-REVISION-OPERATOR-SCOPE'] },
      // Route B — REV-17 관련 권한 기록
      { anyOf: ['E9', 'F-GC001-REV17-ISSUED-2111'] },
    ],
  },
  {
    id: 'PROP-04',
    statement: '문소라는 21:18 메인홀 라벨 변경자가 될 수 없다.',
    supportRules: [
      // 21:18 반입대 작업 + 최소 이동 시간 2분. **둘 다** 필요하다 —
      // 위치만으로는 "2분이면 갈 수 있다" 는 반론이 남는다
      { allOf: ['F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME'] },
      { allOf: ['E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME'] },
      // 본인 진술이 기록과 일치하는 경우도 위치의 근거가 된다
      { allOf: ['CLM-GC001-MUN-LOADING', 'F-GC001-MAIN-LOADING-TRAVEL-TIME'] },
    ],
  },
  {
    id: 'PROP-05',
    statement: '21:18 라벨 변경자는 류나린이다.',
    supportRules: [
      // 세 명제의 결합 — 이것이 candidate transition 이다 (정본 §16)
      { derivedFrom: ['PROP-02', 'PROP-03', 'PROP-04'] },
    ],
  },
  {
    id: 'PROP-06',
    statement: '류나린에게 범행 기회가 존재한다.',
    supportRules: [
      /**
       * 21:04 문 열림 ≠ 실제 퇴장 + 범행 시간. 문 열림 규격을 알거나, 류나린이 퇴장 주장을
       * 고쳐 말한 진술을 쥐고 있으면 된다 — 같은 사실에 이르는 두 길이다.
       */
      { allOf: ['F-GC001-DOOR-OPEN-NOT-PASSAGE', 'F-GC001-CRIME-WINDOW'] },
      { allOf: ['CLM-GC001-RYU-LEFT-PRESSED', 'F-GC001-CRIME-WINDOW'] },
      { allOf: ['F-GC001-DOOR-OPEN-NOT-PASSAGE', 'E4'] },
      { allOf: ['CLM-GC001-RYU-LEFT-PRESSED', 'F-GC001-DOOR-OPEN-NOT-PASSAGE'] },
    ],
  },
  {
    id: 'PROP-07',
    statement: '류나린에게 사건 은폐 동기가 존재한다.',
    supportRules: [
      { anyOf: ['F-GC001-DISMISSAL-NOTICE', 'CLM-GC001-BAE-NOTICE', 'E1'] },
    ],
  },
]

/**
 * 범인 입증 기준 (§26) — **기회 + 은폐 행동과의 연결.**
 * 동기(PROP-07)는 강한 지지이지만 **필수조건이 아니다**: "동기 존재 ≠ 범인 증명" (§25 PROP-07).
 */
export const GC001_CULPRIT_PROOF = {
  suspectId: 'S1',
  requires: ['PROP-05', 'PROP-06'],
} as const

/**
 * 범행 방식 입증 — 「고의적 직접 물리력」은 **사고가 아니라는 명제**로 선다.
 * 수단·신체 묘사는 금칙이므로(정본 §4) 방식의 근거는 분류와 배제뿐이다.
 */
export const GC001_METHOD_PROOF = {
  methodId: '고의적 직접 물리력',
  requires: ['PROP-01'],
} as const

/**
 * **제출 근거의 개수** — 명세 §31 은 2~4개를 말한다.
 *
 * 그러나 §26 은 범인 축에 PROP-05 와 PROP-06 을 **동시에** 요구하고, PROP-05 는 그 자체로
 * 세 명제(02·03·04)의 결합이다. 실제로 세어 보면 두 축 + 방식까지 세우는 최소 조합이
 * **6개**다 (PROP-02 ←1 · PROP-03 ←1 · PROP-04 ←2 · PROP-06 ←1 · PROP-01 ←1).
 * 그래서 상한을 6으로 둔다 — 화면은 "2~4개" 를 권하되 6까지 받는다.
 *
 * 브리핑으로 이미 아는 사실(`F-GC001-CRIME-WINDOW` 같은 전제)은 **근거 칸을 쓰지 않는다**
 * (`ProofContext.given`). 전제를 증거로 사 오게 만들면 4개로는 아무 논증도 못 세운다 —
 * 실측으로 걸린 문제이고, 사람도 전제를 인용하지 않는다.
 *
 * 넘치게 담아 통과하는 것을 막는 것이 상한의 목적이고, 그 목적은 6에서도 지켜진다:
 * 이 사건의 Clue 는 30개가 넘는다.
 *
 * ────────── 실측 수치 (2026-08-28 전수 탐색) ──────────
 * given = ['F-GC001-CRIME-WINDOW'] 전제 하에, 선택 가능 Clue 17종의 모든 조합을 평가:
 *
 *   방식만 PROVEN (PROP-01)       : 최소 2장
 *   범인만 PROVEN (PROP-05+06)    : 최소 5장  (36개 조합)
 *   둘 다 동시에 PROVEN           : 최소 6장  (36개 조합)
 *
 * 예시 (6장, PROVEN):
 *   ['E4','E6','E8','E9','F-GC001-DOOR-OPEN-NOT-PASSAGE','F-GC001-MAIN-LOADING-TRAVEL-TIME']
 *
 * **결론: 명세 §31 의 "2~4개" 는 방식 단독까지만 커버한다.
 * 범인 축을 세우려면 5장, 풀 클리어에는 6장이 수학적 하한이다.
 * max 를 4 이하로 내리면 PROVEN 경로가 전멸한다 — tests/proof.test.ts 의
 * 「§31 게이트」 테스트가 이것을 잡는다.**
 */
export const GC001_CLUE_PICK = { min: 2, recommended: 4, max: 6 } as const
