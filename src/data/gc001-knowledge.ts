/**
 * GC-001 지식 규칙 — **누가 무엇을 묻는 즉시 답하고, 무엇을 숨기는가** (명세 V0.2 §16~§19).
 *
 * 이 표가 팀 3-3-(5) 의 답이다. 팀 지적:
 * *"용의자에게 질문해도 '잘 모르겠다', '원만한 관계였다' 처럼 정보를 회피하는 답변이 반복된다.
 * 심문 자체에서도 스토리를 진행할 수 있는 정보가 충분히 나와야 한다."*
 *
 * 그래서 **일반적인 사실은 그냥 준다** (AC-11). 아래 표에서 `availableFactIds` 가 그 층이고,
 * 그 사실들은 전부 정본에 이미 있던 것이다 — 새 사건 사실을 만들지 않는다 (금지 5).
 *
 * ## 설계에서 지킨 세 줄
 * 1. **숨기는 이유가 있는 사람만 숨긴다.** 다섯 명 전부가 모든 화제에서 방어하면 대화가 벽이 된다.
 * 2. **자기에게 불리하지 않은 사실은 오히려 먼저 말한다.** 류나린이 「수정 권한 자격자」를
 *    순순히 알려주는 것이 그 예다 — 그 사실은 문소라도 함께 가리키므로 그에게 이득이다.
 *    플레이어는 그 답에서 **다음 질문**을 얻는다 (명세 §41).
 * 3. **핵심 비밀은 근거를 쥐고 물어야 열린다.** 단, 근거는 `requiredContextIds` 의 **any-of** 다 —
 *    특정 기록을 특정 인물에게 내밀어야만 열리는 구조는 금지다 (금지 2·AC-04·05·06).
 */

import type { PersonaKnowledgeRule } from '../engine/knowledge'

/**
 * 규칙 표. 같은 (인물·의도)에 여러 줄을 두지 않는다 — 엔진은 첫 줄부터 훑으므로
 * 한 화제의 판단이 두 곳에 나뉘면 다음 사람이 둘 중 하나만 고친다.
 */
export const GC001_KNOWLEDGE: readonly PersonaKnowledgeRule[] = [
  /* ────────── S1 류나린 — 전시 운영 책임자 (통제형) ────────── */
  {
    // 그날의 행적: 초기 진술 두 개를 순순히 말한다. 이 진술이 곧 검증 대상이다
    suspectId: 'S1', intent: 'ASK_TIMELINE',
    baseClaimIds: ['CLM-GC001-RYU-LEFT', 'CLM-GC001-RYU-REENTERED'],
    reaction: 'GUARDED',
  },
  {
    suspectId: 'S1', intent: 'ASK_LOCATION_AT_TIME',
    baseClaimIds: ['CLM-GC001-RYU-LEFT', 'CLM-GC001-RYU-REENTERED'],
    reaction: 'GUARDED',
  },
  {
    /**
     * 퇴장 — 명세 §17 의 그 장면. 추궁이 성립해도 **자백하지 않는다.**
     * *"심문의 목적은 자백 획득이 아니라 퇴장 가설을 검증하는 것"* — 그래서 수정 진술은
     * "문을 열었고 그 뒤는 기록이 말하는 대로다" 에서 멈춘다.
     */
    suspectId: 'S1', intent: 'ASK_DEPARTURE',
    defensiveClaimIds: ['CLM-GC001-RYU-LEFT'],
    revisedClaimIds: ['CLM-GC001-RYU-LEFT-PRESSED'],
    requiredContextIds: ['F-GC001-DOOR-OPEN-NOT-PASSAGE', 'E7', 'E8'],
    reaction: 'DEFENSIVE',
  },
  {
    // 상자 이동은 그에게 불리하지 않다 — 오히려 남을 가리킨다. 그냥 말한다 (AC-11)
    suspectId: 'S1', intent: 'ASK_CRATE_MOVEMENT',
    availableFactIds: ['F-GC001-CRATE-MOVED-2109'],
    reaction: 'NEUTRAL',
  },
  {
    /**
     * 수정 권한 — **자격자가 둘이라는 사실을 순순히 알려준다.**
     * 자기 혼자가 아니라는 뜻이므로 그에게 유리하고, 플레이어에게는 Proof Path B 의 입구가 된다.
     */
    suspectId: 'S1', intent: 'ASK_REVISION_PERMISSION',
    availableFactIds: ['F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-REV17-SESSION-SHARABLE'],
    defensiveClaimIds: ['CLM-GC001-RYU-NO-LABEL'],
    revisedClaimIds: ['CLM-GC001-RYU-REV17-ISSUED'],
    requiredContextIds: ['E9', 'F-GC001-REV17-ISSUED-2111', 'F-GC001-LABEL-CHANGED-2118'],
    reaction: 'DEFENSIVE',
  },
  {
    suspectId: 'S1', intent: 'ASK_LABEL_CHANGE',
    availableFactIds: ['F-GC001-REVISION-OPERATOR-SCOPE'],
    defensiveClaimIds: ['CLM-GC001-RYU-NO-LABEL'],
    revisedClaimIds: ['CLM-GC001-RYU-REV17-ISSUED'],
    requiredContextIds: ['E8', 'E9', 'F-GC001-LABEL-CHANGED-2118'],
    reaction: 'DEFENSIVE',
  },
  {
    // 관계·해임은 그가 가장 감추고 싶은 화제다. 그러나 벽이 되지는 않는다 — 결이 남는다
    suspectId: 'S1', intent: 'ASK_RELATIONSHIP',
    defensiveClaimIds: ['CLM-GC001-RYU-REENTERED'],
    reaction: 'GUARDED',
  },

  /* ────────── S2 배지호 — 부큐레이터 (동요형) ────────── */
  {
    /**
     * 관계를 물으면 **해임 통지를 말한다** (AC-11 · 명세 §40 플레이어 C 경로).
     * 그는 숨길 이유가 없다 — 자기 일이 아니고, 관장 책상에서 본 사실이다.
     * 이 한 줄에서 "류나린에게 동기가 있다" 는 가설이 시작된다.
     */
    suspectId: 'S2', intent: 'ASK_RELATIONSHIP',
    baseClaimIds: ['CLM-GC001-BAE-NOTICE'],
    availableFactIds: ['F-GC001-DISMISSAL-NOTICE'],
    reaction: 'ANXIOUS',
  },
  {
    suspectId: 'S2', intent: 'ASK_TIMELINE',
    defensiveClaimIds: ['CLM-GC001-BAE-CATALOG'],
    revisedClaimIds: ['CLM-GC001-BAE-CALL'],
    requiredContextIds: ['E5', 'E4'],
    reaction: 'ANXIOUS',
  },
  {
    suspectId: 'S2', intent: 'ASK_LOCATION_AT_TIME',
    defensiveClaimIds: ['CLM-GC001-BAE-CATALOG'],
    revisedClaimIds: ['CLM-GC001-BAE-CALL'],
    requiredContextIds: ['E5'],
    reaction: 'ANXIOUS',
  },
  {
    // 사적 통화 — 규정 위반이라 숨긴다. 통화 기록을 쥐면 인정한다
    suspectId: 'S2', intent: 'ASK_PRIVATE_ACTIVITY',
    defensiveClaimIds: ['CLM-GC001-BAE-CATALOG'],
    revisedClaimIds: ['CLM-GC001-BAE-CALL'],
    requiredContextIds: ['E5'],
    reaction: 'ANXIOUS',
  },
  {
    // 발견자다 — 발견 시각과 통화 상황은 그냥 말한다
    suspectId: 'S2', intent: 'ASK_PLINTH_CONDITION',
    availableFactIds: ['F-GC001-CRIME-WINDOW'],
    reaction: 'SHAKEN',
  },

  /* ────────── S3 문소라 — 작품 운송 담당 (불안형) ────────── */
  {
    /**
     * 상자 — 명세 §18 의 그 장면. E3(상자 스캔)이나 21:09 사실을 쥐고 물으면 인정한다.
     * **보상은 새 핵심 Evidence 가 아니다** — 왜 거짓말했는지 이해하고, 그 거짓말이 살인과
     * 무관할 가능성을 판단하는 것이 보상이다 (명세 §18).
     */
    suspectId: 'S3', intent: 'ASK_CRATE_MOVEMENT',
    defensiveClaimIds: ['CLM-GC001-MUN-NO-MOVE'],
    revisedClaimIds: ['CLM-GC001-MUN-MOVED'],
    requiredContextIds: ['E3', 'F-GC001-CRATE-MOVED-2109'],
    reaction: 'ANXIOUS',
  },
  {
    // 21:18 위치는 숨길 이유가 없다 — 이 한 줄이 Proof Path B 의 두 번째 축이다
    suspectId: 'S3', intent: 'ASK_LOCATION_AT_TIME',
    baseClaimIds: ['CLM-GC001-MUN-LOADING'],
    availableFactIds: ['F-GC001-MAIN-LOADING-TRAVEL-TIME'],
    reaction: 'NEUTRAL',
  },
  {
    suspectId: 'S3', intent: 'ASK_TIMELINE',
    baseClaimIds: ['CLM-GC001-MUN-LOADING'],
    defensiveClaimIds: ['CLM-GC001-MUN-NO-MOVE'],
    revisedClaimIds: ['CLM-GC001-MUN-MOVED'],
    requiredContextIds: ['E3', 'F-GC001-CRATE-MOVED-2109'],
    reaction: 'ANXIOUS',
  },
  {
    // 자격자라는 사실과 이동 시간을 그냥 말한다. 그에게는 알리바이이기도 하다
    suspectId: 'S3', intent: 'ASK_REVISION_PERMISSION',
    baseClaimIds: ['CLM-GC001-MUN-LOADING'],
    availableFactIds: ['F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MAIN-LOADING-TRAVEL-TIME'],
    reaction: 'NEUTRAL',
  },
  {
    suspectId: 'S3', intent: 'ASK_LABEL_CHANGE',
    baseClaimIds: ['CLM-GC001-MUN-LOADING'],
    availableFactIds: ['F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MAIN-LOADING-TRAVEL-TIME'],
    reaction: 'ANXIOUS',
  },
  {
    suspectId: 'S3', intent: 'ASK_RELATIONSHIP',
    baseClaimIds: ['CLM-GC001-MUN-LOADING'],
    reaction: 'ANXIOUS',
  },

  /* ────────── S4 도율 — 작품 보존 담당 (방어적) ────────── */
  {
    /**
     * 받침대 — **20:40 정상 확인을 자랑스럽게 말한다** (AC-11).
     * 이 사실이 "사고설" 을 약화시키는 첫 조각이다 (IQ01 · 명세 §40 플레이어 C 경로).
     */
    suspectId: 'S4', intent: 'ASK_PLINTH_CONDITION',
    baseClaimIds: ['CLM-GC001-DO-EXITED'],
    availableFactIds: ['F-GC001-PLINTH-OK-2040'],
    reaction: 'DEFENSIVE',
  },
  {
    suspectId: 'S4', intent: 'ASK_TIMELINE',
    baseClaimIds: ['CLM-GC001-DO-EXITED'],
    availableFactIds: ['F-GC001-PLINTH-OK-2040'],
    reaction: 'DEFENSIVE',
  },
  {
    suspectId: 'S4', intent: 'ASK_LOCATION_AT_TIME',
    baseClaimIds: ['CLM-GC001-DO-EXITED'],
    reaction: 'DEFENSIVE',
  },
  {
    suspectId: 'S4', intent: 'ASK_DEPARTURE',
    baseClaimIds: ['CLM-GC001-DO-EXITED'],
    reaction: 'NEUTRAL',
  },
  {
    // 점검 누락 부탁은 숨긴다. 현장 판정이나 외부 도착 기록을 쥐면 인정한다
    suspectId: 'S4', intent: 'ASK_RELATIONSHIP',
    defensiveClaimIds: ['CLM-GC001-DO-NO-DISPUTE'],
    revisedClaimIds: ['CLM-GC001-DO-REPORT-PLEA'],
    requiredContextIds: ['E4', 'E2', 'F-GC001-DEATH-CLASSIFICATION'],
    reaction: 'DEFENSIVE',
  },

  /* ────────── S5 김하늘 — 야간 보안 담당 (회피형) ────────── */
  {
    /**
     * 카메라 — 명세 §19 의 그 장면. **E05 를 새로 만들지 않는다.**
     * 카메라 기록은 별도의 조사 대상으로 이미 존재하고, 이 대화는 "시야가 열렸었다" 는
     * 사실을 확인해 줄 뿐이다. 근거는 any-of 라 상자 기록·카메라 기록·라벨 교체 사실 중
     * 아무거나로 열린다 (AC-04: E03 을 반드시 제시하지 않아도 된다).
     */
    suspectId: 'S5', intent: 'ASK_CAMERA_STATUS',
    defensiveClaimIds: ['CLM-GC001-GIM-BLOCKED'],
    revisedClaimIds: ['CLM-GC001-GIM-MISSED-FRAME'],
    requiredContextIds: ['E3', 'E8', 'F-GC001-LABEL-CHANGED-2118', 'F-GC001-CRATE-MOVED-2109'],
    reaction: 'GUARDED',
  },
  {
    /**
     * 출입 패널 — **문 열림이 통과를 뜻하지 않는다는 규격을 그냥 알려준다** (AC-11).
     * 보안 담당의 상식이고 숨길 이유가 없다. 이 한 줄에서 IQ03(류나린은 정말 나갔는가)이 열린다.
     */
    suspectId: 'S5', intent: 'ASK_ACCESS_PANEL',
    baseClaimIds: ['CLM-GC001-GIM-PANEL'],
    availableFactIds: ['F-GC001-DOOR-OPEN-NOT-PASSAGE'],
    reaction: 'NEUTRAL',
  },
  {
    suspectId: 'S5', intent: 'ASK_TIMELINE',
    baseClaimIds: ['CLM-GC001-GIM-PANEL'],
    defensiveClaimIds: ['CLM-GC001-GIM-BLOCKED'],
    revisedClaimIds: ['CLM-GC001-GIM-MISSED-FRAME'],
    requiredContextIds: ['E3', 'E8', 'F-GC001-LABEL-CHANGED-2118'],
    reaction: 'GUARDED',
  },
  {
    suspectId: 'S5', intent: 'ASK_LOCATION_AT_TIME',
    baseClaimIds: ['CLM-GC001-GIM-PANEL'],
    availableFactIds: ['F-GC001-DOOR-OPEN-NOT-PASSAGE'],
    reaction: 'NEUTRAL',
  },
  {
    suspectId: 'S5', intent: 'ASK_DEPARTURE',
    baseClaimIds: ['CLM-GC001-GIM-PANEL'],
    availableFactIds: ['F-GC001-DOOR-OPEN-NOT-PASSAGE'],
    reaction: 'NEUTRAL',
  },
  {
    suspectId: 'S5', intent: 'ASK_RELATIONSHIP',
    baseClaimIds: ['CLM-GC001-GIM-PANEL'],
    reaction: 'GUARDED',
  },
]
