/**
 * GC-001 조사 데이터 — **Claim · Fact · Investigation Question** (명세 V0.2 §7·§17~§20·§23).
 *
 * 정본: `docs/content/GC001-골든케이스-정본.md`. **id 는 정본의 것을 그대로 쓴다** —
 * 문서와 코드가 다른 이름을 쓰면 다음 사람이 둘을 대조할 수 없다.
 *
 * ## 이 파일이 하지 않는 것
 * - **Truth 를 바꾸지 않는다** (명세 §2). 범인·시각·수단·행동·타임라인은 정본 그대로다.
 *   여기 적히는 것은 *플레이어가 만나는 표현*(진술문·사실문)뿐이다.
 * - **새 사건 사실을 만들지 않는다.** 아래 Fact 는 전부 정본에 이미 있는 규칙을
 *   플레이어가 확인할 수 있는 형태로 **승격**한 것이다 (명세 §23).
 * - **판정하지 않는다.** `tension`(충돌 가능 Clue)은 "충돌한다" 가 아니라 "비교해 볼 만하다" 다.
 *
 * ## 수단·신체·유혈 어휘 금지 (정본 §4)
 * 진술문·사실문에도 같은 규칙이 걸린다. `tests/gc001.test.ts` 의 금칙어 스캔이 이 파일까지 훑는다.
 */

import type { SuspectId } from '../types'
import type { ClaimDef, FactDef } from '../engine/inquiry'

/* ────────────────────────────── Fact — 객관적으로 확정된 것 ────────────────────────────── */

/**
 * 명세 §23 은 두 규칙을 **Player-facing Fact 로 승격**하라고 지시한다. 둘 다 정본 §7 에
 * 이미 있던 사건 내부 규칙이고, 없으면 Proof Path B(권한·위치)가 성립하지 않는다.
 *
 * 나머지 Fact 들은 정본 타임라인·Evidence 에서 **객관적으로 확정된 것만** 옮겼다.
 * 시스템은 이 Fact 들로 결론을 내주지 않는다 — 연결은 플레이어가 한다.
 */
export const GC001_FACTS: readonly FactDef[] = [
  {
    id: 'F-GC001-REVISION-OPERATOR-SCOPE',
    text: '목록대의 정식 라벨 수정 모드를 쓸 수 있는 담당은 둘뿐이다 — 전시 운영 담당(류나린)과 작품 운송 담당(문소라).',
    source: '갤러리 운영 규정 · 권한 대장',
  },
  {
    id: 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
    text: '메인 전시홀과 고정 반입대 사이의 최소 이동 시간은 2분이다. 같은 시각 양쪽에 고정된 작업 기록은 한 사람의 것일 수 없다.',
    source: '갤러리 도면 · 동선 실측',
  },
  {
    id: 'F-GC001-DOOR-OPEN-NOT-PASSAGE',
    text: '반입문 출입 패널은 문이 열린 사실만 남긴다. 통과 여부는 기록하지 않는다.',
    source: '출입 패널 규격서',
    known: true,
  },
  {
    id: 'F-GC001-CRIME-WINDOW',
    text: '피해자는 21:15까지 운영위원과 통화 중이었고, 21:21에 발견됐다.',
    source: '데스크 통화 기록 · 발견 신고',
    known: true,
  },
  {
    id: 'F-GC001-PLINTH-OK-2040',
    text: '20:40 점검에서 전시 받침대는 정상으로 확인됐다.',
    source: '보존 담당 점검 기록',
  },
  {
    id: 'F-GC001-LABEL-CHANGED-2118',
    text: '21:18 메인 전시홀에서 목록대의 라벨이 교체됐다. 작업자의 얼굴은 식별되지 않는다.',
    source: '카메라 기록의 좁은 시야 조각',
  },
  {
    id: 'F-GC001-REV17-ISSUED-2111',
    text: '21:11 정식 수정 라벨 세션 REV-17-084 가 류나린의 권한으로 발급됐다.',
    source: '수정 라벨 발급 기록',
  },
  {
    id: 'F-GC001-REV17-SESSION-SHARABLE',
    text: '발급된 수정 세션이 열려 있는 동안 다른 자격자가 대신 사용했는지는 별도 사용자 기록에 남지 않는다.',
    source: '수정 라벨 시스템 규격서',
  },
  {
    id: 'F-GC001-MUN-AT-LOADING-2118',
    text: '21:18 문소라는 고정 반입대에서 상자 상태를 확인하는 작업 기록을 남겼다.',
    source: '반입대 고정 작업 기록',
  },
  {
    id: 'F-GC001-DISMISSAL-NOTICE',
    text: '20:55 해임 통지가 출력되고, 21:30 운영위원 보고가 예약돼 있었다.',
    source: '큐레이터 데스크 기록',
  },
  {
    id: 'F-GC001-DEATH-CLASSIFICATION',
    text: '현장 판정은 고의적 직접 물리력으로 분류됐다. 받침대 사전 결함·우발적 구조 붕괴·약물 요인은 배제됐다.',
    source: '구조화 현장 판정',
  },
  {
    id: 'F-GC001-CRATE-MOVED-2109',
    text: '21:09 운송 상자가 예정 밖으로 옮겨졌고, 21:10 그 상자에 임시 위치 표식이 붙었다.',
    source: '운송 상자 스캔 기록',
  },
]

/* ────────────────────────────── Claim — 인물이 한 말 ────────────────────────────── */

/**
 * 초기 공개 진술(정본 §10) + 추궁 뒤의 수정 진술.
 *
 * `tension` 은 **비교해 볼 만한 Clue** 다. 하나가 손에 들어오면 그 Claim 은 `QUESTIONABLE` 이
 * 되지만, 그건 "거짓말" 이 아니라 "확인이 필요하다" 는 뜻이다 (AC-12).
 *
 * `revisedTo` 가 없는 인물은 그 화제에서 말을 고치지 않는다 — **모든 용의자가 모든 질문에
 * 거짓말할 필요는 없다** (명세 §9 1단계).
 */
export const GC001_CLAIMS: readonly ClaimDef[] = [
  /* ── 류나린 (범인) ── */
  {
    id: 'CLM-GC001-RYU-LEFT',
    speaker: 'S1',
    at: '21:04',
    text: '21시 4분에 반입문으로 나갔습니다.',
    // 문 열림 기록은 통과를 증명하지 않는다 — 그 사실을 알면 이 진술이 흔들린다
    tension: ['F-GC001-DOOR-OPEN-NOT-PASSAGE', 'E7', 'E8'],
    // **자백으로 바뀌지 않는다.** 심문의 목적은 자백이 아니라 퇴장 가설의 검증이다 (명세 §17)
    revisedTo: 'CLM-GC001-RYU-LEFT-PRESSED',
  },
  {
    id: 'CLM-GC001-RYU-LEFT-PRESSED',
    speaker: 'S1',
    at: '21:04',
    revises: 'CLM-GC001-RYU-LEFT',
    text: '문을 열었고, 그 뒤는 기록이 말하는 대로입니다. 제 배지로 열렸다는 것 외에 무엇이 더 남아 있습니까.',
  },
  {
    id: 'CLM-GC001-RYU-REENTERED',
    speaker: 'S1',
    at: '21:22',
    text: '21시 22분 호출을 받고 반입문으로 들어왔습니다.',
  },
  {
    id: 'CLM-GC001-RYU-REV17-ISSUED',
    speaker: 'S1',
    at: '21:11',
    text: '21시 11분 REV-17-084 가 제 수정 권한으로 발급된 것은 맞습니다.',
  },
  {
    id: 'CLM-GC001-RYU-NO-LABEL',
    speaker: 'S1',
    at: '21:18',
    text: '라벨을 직접 바꾼 적은 없습니다. 세션은 열어 두고 나왔을 뿐입니다.',
    tension: ['F-GC001-LABEL-CHANGED-2118', 'F-GC001-MUN-AT-LOADING-2118', 'E9'],
  },

  /* ── 배지호 ── */
  {
    id: 'CLM-GC001-BAE-CATALOG',
    speaker: 'S2',
    at: '21:10',
    text: '큐레이터 데스크에서는 도록 수정만 하고 있었습니다.',
    tension: ['E5', 'E4'],
    revisedTo: 'CLM-GC001-BAE-CALL',
  },
  {
    id: 'CLM-GC001-BAE-CALL',
    speaker: 'S2',
    at: '21:10',
    revises: 'CLM-GC001-BAE-CATALOG',
    text: '도록 수정이 아니었습니다. 기증자와 이직 이야기를 하고 있었습니다 — 규정 위반이라 말하지 못했습니다.',
  },
  {
    id: 'CLM-GC001-BAE-NOTICE',
    speaker: 'S2',
    text: '해임 통지의 수신자는 류나린이었습니다. 관장님 책상에서 봤습니다.',
  },

  /* ── 문소라 ── */
  {
    id: 'CLM-GC001-MUN-NO-MOVE',
    speaker: 'S3',
    at: '21:09',
    text: '폐관 뒤에는 어떤 운송 상자도 옮기지 않았습니다.',
    tension: ['E3', 'F-GC001-CRATE-MOVED-2109'],
    revisedTo: 'CLM-GC001-MUN-MOVED',
  },
  {
    id: 'CLM-GC001-MUN-MOVED',
    speaker: 'S3',
    at: '21:09',
    revises: 'CLM-GC001-MUN-NO-MOVE',
    text: '통로를 비우려 잠깐 옮겼습니다. 라벨이 어긋난 건 제 탓입니다 — 설치 책임을 지고 싶지 않았습니다.',
  },
  {
    id: 'CLM-GC001-MUN-LOADING',
    speaker: 'S3',
    at: '21:18',
    text: '21시 18분에는 고정 반입대에서 상자 상태를 확인하고 있었습니다.',
  },

  /* ── 도율 ── */
  {
    id: 'CLM-GC001-DO-NO-DISPUTE',
    speaker: 'S4',
    text: '관장님과 따로 점검 문제를 상의한 적은 없습니다.',
    tension: ['E4', 'F-GC001-PLINTH-OK-2040'],
    revisedTo: 'CLM-GC001-DO-REPORT-PLEA',
  },
  {
    id: 'CLM-GC001-DO-REPORT-PLEA',
    speaker: 'S4',
    revises: 'CLM-GC001-DO-NO-DISPUTE',
    text: '이전 점검 누락을 고쳐 달라 부탁한 적은 있습니다. 그러나 당일 받침대는 정상으로 확인했습니다.',
  },
  {
    id: 'CLM-GC001-DO-EXITED',
    speaker: 'S4',
    at: '21:12',
    text: '21시 12분에 갤러리에서 나갔습니다.',
  },

  /* ── 김하늘 ── */
  {
    id: 'CLM-GC001-GIM-BLOCKED',
    speaker: 'S5',
    at: '21:00',
    text: '21시 이후 카메라는 파티션에 완전히 가려져 아무 장면도 남지 않았습니다.',
    tension: ['E3', 'E8', 'F-GC001-LABEL-CHANGED-2118'],
    revisedTo: 'CLM-GC001-GIM-MISSED-FRAME',
  },
  {
    id: 'CLM-GC001-GIM-MISSED-FRAME',
    speaker: 'S5',
    at: '21:18',
    revises: 'CLM-GC001-GIM-BLOCKED',
    text: '반입문 출입 패널을 보는 동안 잠깐 열린 카메라 시야를 놓쳤습니다. 그 구간 기록은 남아 있을 겁니다.',
  },
  {
    id: 'CLM-GC001-GIM-PANEL',
    speaker: 'S5',
    at: '21:16',
    text: '21시 15분부터 19분까지 반입문 출입 패널을 점검하고 있었습니다.',
  },
]

/* ────────────────────────────── Investigation Question — 내부 수사 구조 ────────────────────────────── */

/**
 * 명세 §20. **플레이어에게 Quest 목록처럼 자동 제공하지 않는다.**
 * 이 목록은 내용 설계와 테스트가 "무엇이 열려 있어야 하는가" 를 재는 자다.
 */
export interface InvestigationQuestion {
  id: string
  text: string
  /** 이 의문에 답이 되는 Clue 들 — 하나라도 손에 있으면 그 의문은 다뤄지기 시작한 것이다 */
  answeredBy: string[]
}

export const GC001_INVESTIGATION_QUESTIONS: readonly InvestigationQuestion[] = [
  { id: 'IQ01', text: '정말 사고였는가?', answeredBy: ['F-GC001-DEATH-CLASSIFICATION', 'F-GC001-PLINTH-OK-2040', 'E4'] },
  { id: 'IQ02', text: '사건은 언제 발생했는가?', answeredBy: ['F-GC001-CRIME-WINDOW', 'E4'] },
  { id: 'IQ03', text: '류나린은 정말 21:04에 나갔는가?', answeredBy: ['F-GC001-DOOR-OPEN-NOT-PASSAGE', 'CLM-GC001-RYU-LEFT', 'E7'] },
  { id: 'IQ04', text: '문소라는 왜 상자를 옮겼는가?', answeredBy: ['CLM-GC001-MUN-MOVED', 'E3', 'F-GC001-CRATE-MOVED-2109'] },
  { id: 'IQ05', text: '카메라는 정말 계속 가려져 있었는가?', answeredBy: ['CLM-GC001-GIM-MISSED-FRAME', 'E8', 'F-GC001-LABEL-CHANGED-2118'] },
  { id: 'IQ06', text: '21:18 라벨을 바꾼 사람은 누구인가?', answeredBy: ['F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MUN-AT-LOADING-2118', 'E9'] },
  { id: 'IQ07', text: '배지호는 무엇을 숨기고 있는가?', answeredBy: ['CLM-GC001-BAE-CALL', 'E5'] },
  { id: 'IQ08', text: '도율은 무엇을 숨기고 있는가?', answeredBy: ['CLM-GC001-DO-REPORT-PLEA', 'E2'] },
]

/* ────────────────────────────── 조회 헬퍼 ────────────────────────────── */

const CLAIM_BY_ID = new Map(GC001_CLAIMS.map((c) => [c.id, c]))
const FACT_BY_ID = new Map(GC001_FACTS.map((f) => [f.id, f]))

export const gc001Claim = (id: string): ClaimDef | undefined => CLAIM_BY_ID.get(id)
export const gc001Fact = (id: string): FactDef | undefined => FACT_BY_ID.get(id)

/** 그 인물의 초기 공개 진술들 — 수정 진술(`revises` 가 있는 것)은 빠진다 */
export const gc001OpeningClaims = (s: SuspectId): ClaimDef[] =>
  GC001_CLAIMS.filter((c) => c.speaker === s && !c.revises)

/** 처음부터 알고 있는 Fact — 브리핑에 포함된 것 */
export const gc001KnownFacts = (): FactDef[] => GC001_FACTS.filter((f) => f.known)
