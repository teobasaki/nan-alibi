/**
 * 질문 의도 — **자유 질문을 의미 단위로 읽는다** (명세 V0.2 §10~§12).
 *
 * 팀 지적(3-3-(5) 2단계): *"플레이어가 개발자가 예상한 정확한 질문 문장을 입력해야만 정보를
 * 얻을 수 있다면 AI 심문의 장점이 크게 줄어든다."* 그래서 문장 일치가 아니라 의도를 읽는다.
 *
 * ```
 * "9시 4분에 진짜 나간 겁니까?"   "21시 4분 이후 밖에 있었습니까?"   "반입문으로 실제 나간 게 맞아요?"
 *                              ↓  전부 같은 의도
 *                        ASK_DEPARTURE
 * ```
 *
 * ## 왜 LLM 에 맡기지 않는가 (ADR 031 의 버린 대안)
 * 의도 분류는 **어떤 Claim 이 열리는지**를 정한다. 그것을 AI 가 판정하면 진행 조건을 AI 가
 * 소유하게 된다 (명세 §35·금지 5 위반). 그래서 결정론 규칙으로 분류하고, 못 읽으면
 * **못 읽은 채로** 페르소나에게 넘긴다 — 명세 §12: 의도 해석 실패도 정상 응답이며 질문 1회를
 * 소모한다. 무료 재시도를 주지 않는다 (금지 6).
 *
 * ## 이 파일의 경계
 * - **게임 Truth 를 판단하지 않는다** (명세 §11). 여기서 나오는 것은 "무엇을 물었나" 뿐이고,
 *   "무엇을 답할 수 있나" 는 규칙 엔진(knowledge)이 정한다.
 * - `Math.random()` 없음. 같은 문장은 언제나 같은 의도다 — 재현 없이는 밸런스를 못 잡는다.
 */

import { SUSPECTS, type SuspectId } from '../types'

/** 명세 §10 의 14종 + 못 읽었을 때의 `UNKNOWN` */
export type QuestionIntent =
  | 'ASK_RELATIONSHIP'
  | 'ASK_TIMELINE'
  | 'ASK_LOCATION_AT_TIME'
  | 'ASK_DEPARTURE'
  | 'ASK_CRATE_MOVEMENT'
  | 'ASK_CAMERA_STATUS'
  | 'ASK_ACCESS_PANEL'
  | 'ASK_PLINTH_CONDITION'
  | 'ASK_LABEL_CHANGE'
  | 'ASK_REVISION_PERMISSION'
  | 'ASK_PRIVATE_ACTIVITY'
  | 'ASK_REASON_FOR_LIE'
  | 'CHALLENGE_CLAIM'
  | 'PRESENT_CLUE'
  /** 의도를 못 읽었다. **실패가 아니라 상태다** — 페르소나는 "무엇을 말씀하시는지 모르겠다" 로 답한다 */
  | 'UNKNOWN'

export interface QuestionIntentResult {
  intent: QuestionIntent
  /** 질문이 가리키는 **다른 인물** (예: "문소라는 그때 어디 있었습니까?") */
  subjectId?: SuspectId
  /** 정규화된 시각 `HH:MM`. 이 사건의 밤은 21시대다 — "9시 4분" 도 21:04 로 읽는다 */
  time?: string
  /** 질문이 근거로 든 Clue id 들 (제시 경로에서 호출부가 넣는다) */
  referencedClueIds?: string[]
  /** 0~1. 낮으면 페르소나가 "정확히 어떤 일을 말씀하시는지" 로 되묻는다 */
  confidence: number
}

export interface ClassifyContext {
  /** 지금 마주 앉은 사람 — "당신" 이 누구인지 */
  speaker?: SuspectId
  /** 이름 → id (사건이 소유한 이름이므로 밖에서 받는다. 라벨 하드코딩 금지 — 불변식 6) */
  names?: Record<string, SuspectId>
  /** 함께 들이민 Clue — 있으면 의도는 `PRESENT_CLUE` 다 */
  presentedClueIds?: string[]
  /** 사건의 시각 라벨 5개 — 시각 표현을 이 중 하나로 스냅한다 */
  slotLabels?: readonly string[]
}

/* ────────────────────────────── 어휘 ────────────────────────────── */

/**
 * 의도별 표지 어휘. **어절이 아니라 조각으로 찾는다** — 한국어는 조사·활용이 붙으므로
 * "나갔습니까/나간/나가셨나요" 를 다 잡으려면 어간 조각(`나가`·`나갔`·`나간`)이 필요하다.
 *
 * 점수는 조각 하나당 1점, 아래 `WEIGHT` 로 의도별 가중치를 준다. 동점이면 배열 순서가 이긴다.
 */
const CUES: Record<Exclude<QuestionIntent, 'PRESENT_CLUE' | 'UNKNOWN'>, string[]> = {
  // 퇴장·재입장 — "밖" 계열이 여기 있는 이유는 아래 WEIGHT 주석에 있다
  ASK_DEPARTURE: ['나갔', '나간', '나가', '나섰', '퇴장', '밖에', '밖으로', '나오', '떠났', '들어왔', '들어온', '재입장', '빠져나'],
  // 라벨 교체
  ASK_LABEL_CHANGE: ['라벨', '표식', '목록대', '명패', '설명판', '교체', '갈아', '바꿔', '바꾼', '바꿨'],
  // 수정 권한·세션
  ASK_REVISION_PERMISSION: ['권한', '수정 권한', '세션', 'rev-17', 'rev17', '발급', '자격', '리비전', '수정 모드'],
  // 카메라
  ASK_CAMERA_STATUS: ['카메라', 'cctv', '씨씨티비', '촬영', '녹화', '시야', '화면', '가려', '가렸', '사각'],
  // 반입문·출입 기록
  ASK_ACCESS_PANEL: ['반입문', '출입', '배지', '패널', '문이 열', '문 열', '카드', '기록이 열'],
  // 운송 상자
  ASK_CRATE_MOVEMENT: ['상자', '운송', '크레이트', '박스', '옮겼', '옮긴', '옮기'],
  // 받침대·사고설
  ASK_PLINTH_CONDITION: ['받침대', '좌대', '전시대', '구조물', '넘어졌', '넘어진', '쓰러', '사고', '결함', '점검'],
  // 개인 행동
  ASK_PRIVATE_ACTIVITY: ['사적', '개인적', '개인 용무', '통화', '전화', '누구와', '몰래', '따로', '혼자'],
  // 관계
  ASK_RELATIONSHIP: ['관계', '사이', '친했', '친하', '어떤 분', '어떤 사람', '원한', '갈등', '불화', '감정', '해임', '보고'],
  // 그날 전체 행적
  ASK_TIMELINE: ['행적', '동선', '그날', '당일', '하루', '순서대로', '처음부터', '일과', '무엇을 했', '뭐 했', '뭐 하셨'],
  // 특정 시각의 위치 — '있었습니까' 는 '있었' 의 부분집합이라 넣지 않는다 (같은 조각을 두 번 세면
  // 어투가 화제를 이겨 버린다: "21시 4분 이후 밖에 있었습니까?" 가 퇴장이 아니라 위치로 읽혔다)
  ASK_LOCATION_AT_TIME: ['어디', '위치', '어느', '계셨', '있었', '머물'],
  // 말이 달라진 이유
  ASK_REASON_FOR_LIE: ['왜 말', '왜 안', '왜 숨', '왜 거짓', '왜 다르', '왜 그렇게 말', '아까는', '앞서는', '먼저 말하지', '이제야', '말을 바꾸'],
  // 진술 추궁
  CHALLENGE_CLAIM: ['증명', '어떻게 믿', '믿을 수', '말이 안', '앞뒤가', '정말', '진짜', '확실', '맞습니까', '맞아요', '사실입니까'],
}

/**
 * 가중치 — **화제가 태도를 이긴다.**
 *
 * "9시 4분에 **진짜** 나간 겁니까?" 는 추궁 어투('진짜')와 화제('나간')를 함께 갖는다.
 * 명세 §10 은 이 문장을 `ASK_DEPARTURE` 로 읽으라고 예시로 못 박았다 — 어투는 감정이고
 * 화제가 정보이므로, 무엇을 답해야 하는지는 화제가 정한다.
 * 같은 이유로 "어디/있었" 은 가장 약하다 — 거의 모든 질문에 붙는 말이라 표지로 약하다.
 */
const WEIGHT: Partial<Record<QuestionIntent, number>> = {
  ASK_DEPARTURE: 3,
  ASK_LABEL_CHANGE: 3,
  ASK_REVISION_PERMISSION: 3,
  ASK_CRATE_MOVEMENT: 3,
  ASK_CAMERA_STATUS: 3,
  ASK_ACCESS_PANEL: 2.5,
  ASK_PLINTH_CONDITION: 2.5,
  ASK_PRIVATE_ACTIVITY: 2,
  ASK_REASON_FOR_LIE: 2.5,
  ASK_RELATIONSHIP: 2,
  ASK_TIMELINE: 1.6,
  CHALLENGE_CLAIM: 1.2,
  ASK_LOCATION_AT_TIME: 1,
}

/* ────────────────────────────── 시각 읽기 ────────────────────────────── */

const KO_NUM: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12,
}

/**
 * 한국어 숫자말로 적힌 **분** — "십분"·"이십오분"·"사분".
 * 시각(한/두/세…)과 분(일/이/삼…)은 한국어에서 서로 다른 수사 계열을 쓴다 —
 * "아홉시 십분" 은 되지만 "아홉시 열분" 은 안 된다. 그래서 표를 따로 둔다.
 */
const KO_MIN_UNIT: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 }

function readKoMinutes(s: string): number | undefined {
  // 십 · 십오 · 이십 · 이십오 · 사십오 …
  const tens = /(([이삼사오])?십)(([일이삼사오육칠팔구]))?/.exec(s)
  if (tens) {
    const t = tens[2] ? KO_MIN_UNIT[tens[2]]! * 10 : 10
    const u = tens[4] ? KO_MIN_UNIT[tens[4]]! : 0
    return t + u
  }
  const one = /^([일이삼사오육칠팔구])$/.exec(s.trim())
  return one ? KO_MIN_UNIT[one[1]!] : undefined
}

/**
 * 시각 표현을 `HH:MM` 으로. **이 사건의 밤은 21시대다** — 12시간제(9시)로 물어도 21시로 읽는다.
 * 라벨을 하드코딩하지 않는다(불변식 6): 사건이 준 `slotLabels` 중 **가장 가까운 칸**으로 스냅한다.
 */
export function readTime(q: string, slotLabels?: readonly string[]): string | undefined {
  const t = q.replace(/\s+/g, ' ')
  let h: number | undefined
  let m = 0

  // 21:04 · 21시 4분 · 9시4분 · 아홉시 십분
  const hm = /(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?/.exec(t)
  if (hm) {
    h = Number(hm[1])
    if (hm[2] !== undefined) m = Number(hm[2])
  } else {
    const ko = new RegExp(`(${Object.keys(KO_NUM).join('|')})\\s*시`).exec(t)
    if (ko) {
      h = KO_NUM[ko[1]!]
      // "아홉시 십분" — 시 뒤에 오는 한국어 분
      const tail = t.slice(ko.index + ko[0].length)
      const koMin = /^\s*([일이삼사오육칠팔구십]+)\s*분/.exec(tail)
      if (koMin) m = readKoMinutes(koMin[1]!) ?? 0
      else {
        const numMin = /^\s*(\d{1,2})\s*분/.exec(tail)
        if (numMin) m = Number(numMin[1])
      }
    }
  }
  if (h === undefined || !Number.isFinite(h)) return undefined
  // 12시간제 → 밤. 사건 시각대(21시)와 맞추기 위해 오후로 읽는다
  if (h <= 12) h += 12
  if (h > 23) return undefined
  const exact = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (!slotLabels?.length) return exact

  // 사건의 칸으로 스냅 — "9시쯤" 처럼 분이 없는 물음도 가장 가까운 칸을 가리킨다
  const mins = (s: string): number => {
    const p = /(\d{1,2}):(\d{2})/.exec(s)
    return p ? Number(p[1]) * 60 + Number(p[2]) : NaN
  }
  const target = h * 60 + m
  let best: string | undefined
  let gap = Infinity
  for (const label of slotLabels) {
    const v = mins(label)
    if (!Number.isFinite(v)) continue
    const d = Math.abs(v - target)
    if (d < gap) { gap = d; best = label }
  }
  // 12분 넘게 벗어나면 그 칸을 물은 것으로 보지 않는다 (칸 간격 최소 2분·최대 10분)
  return best && gap <= 12 ? best : exact
}

/* ────────────────────────────── 분류 ────────────────────────────── */

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * 질문 하나를 읽는다. **판정하지 않는다** — 무엇을 물었는지만 돌려준다 (명세 §11).
 */
export function classify(question: string, ctx: ClassifyContext = {}): QuestionIntentResult {
  const q = norm(question)
  const time = readTime(question, ctx.slotLabels)

  // 다른 사람 이름이 나오면 그 사람에 대한 질문이다
  let subjectId: SuspectId | undefined
  for (const [name, id] of Object.entries(ctx.names ?? {})) {
    if (name && q.includes(norm(name))) { subjectId = id; break }
  }
  if (!subjectId) {
    // 이름 대신 id 를 그대로 쓴 개발·테스트 경로
    for (const s of SUSPECTS) if (q.includes(s.toLowerCase())) { subjectId = s; break }
  }

  /**
   * **Clue 를 들이밀었으면 그것이 곧 의도다** (명세 §10 PRESENT_CLUE).
   * 이 경로는 텍스트로 추측하지 않는다 — 무엇을 내밀었는지는 호출부가 이미 안다.
   */
  if (ctx.presentedClueIds?.length) {
    return {
      intent: 'PRESENT_CLUE',
      referencedClueIds: [...ctx.presentedClueIds],
      ...(subjectId ? { subjectId } : {}),
      ...(time ? { time } : {}),
      confidence: 1,
    }
  }

  if (!q) return { intent: 'UNKNOWN', confidence: 0 }

  const scores = new Map<QuestionIntent, number>()
  for (const [intent, cues] of Object.entries(CUES) as [QuestionIntent, string[]][]) {
    let hit = 0
    for (const c of cues) if (q.includes(c)) hit++
    if (hit > 0) scores.set(intent, hit * (WEIGHT[intent] ?? 1))
  }

  /**
   * 시각이 붙은 질문은 "그 시각의 위치" 를 묻는 쪽으로 기운다 — 단, 화제 어휘가 있으면
   * 그쪽이 이긴다(위 WEIGHT). 시각만 있고 화제가 없을 때 이 보정이 일한다:
   * "9시쯤 뭐 하고 있었어요?" → 시각 + 행적 → 그 시각의 위치를 묻는 것으로 읽는다.
   */
  if (time) scores.set('ASK_LOCATION_AT_TIME', (scores.get('ASK_LOCATION_AT_TIME') ?? 0) + 1.4)

  if (scores.size === 0) return { intent: 'UNKNOWN', confidence: 0.1, ...(time ? { time } : {}) }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [intent, top] = ranked[0]!
  const second = ranked[1]?.[1] ?? 0
  /**
   * 확신도 — 1위 점수의 크기와 2위와의 간격으로 만든다.
   * 낮으면(≤0.45) 페르소나가 되묻는다. **그래도 질문 1회는 소모된다** (명세 §12).
   */
  const confidence = Math.max(0.15, Math.min(1,
    (top / (top + second + 1)) + Math.min(0.3, (top - second) / 8)))

  return {
    intent,
    ...(subjectId ? { subjectId } : {}),
    ...(time ? { time } : {}),
    confidence: +confidence.toFixed(2),
  }
}

/** 되묻는 편이 나은 질문인가 — 이 값이 참이어도 **질문 횟수는 차감된다** (명세 §12) */
export const isVague = (r: QuestionIntentResult): boolean =>
  r.intent === 'UNKNOWN' || r.confidence <= 0.45
