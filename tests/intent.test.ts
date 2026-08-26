/**
 * 질문 의도 분류 — **표현이 달라도 같은 의도로 읽히는가** (명세 V0.2 §10~§12).
 *
 * 이 파일의 첫 블록은 명세가 예시로 못 박은 문장들이다. 그 셋이 한 의도로 가지 않으면
 * "정확한 질문 문장을 맞혀야 하는 게임" 으로 되돌아간다 — 팀 3-3-(5) 2단계의 그 지적이다.
 */
import { describe, expect, it } from 'vitest'
import { classify, isVague, readTime, type QuestionIntent } from '../src/engine/intent'
import { gc001Case } from '../src/data/gc001'
import { slotLabel, SLOTS } from '../src/types'

const CASE = gc001Case()
const SLOT_LABELS = SLOTS.map((t) => slotLabel(CASE, t))
const NAMES = Object.fromEntries(
  Object.values(CASE.suspects).map((s) => [s.name, s.id]),
)
const ctx = { names: NAMES, slotLabels: SLOT_LABELS }
const of = (q: string): QuestionIntent => classify(q, ctx).intent

describe('명세 §10 의 예시 — 세 문장이 한 의도로 간다', () => {
  const same = [
    '9시 4분에 진짜 나간 겁니까?',
    '21시 4분 이후 밖에 있었습니까?',
    '반입문으로 실제 나간 게 맞아요?',
  ]
  for (const q of same) {
    it(`ASK_DEPARTURE ← "${q}"`, () => expect(of(q)).toBe('ASK_DEPARTURE'))
  }
})

describe('3-3-(5) 2단계 — 같은 의도의 다른 표현', () => {
  const cases: [string, QuestionIntent][] = [
    ['사건 당시 어디 있었습니까?', 'ASK_LOCATION_AT_TIME'],
    ['9시쯤 뭐 하고 있었어요?', 'ASK_LOCATION_AT_TIME'],
    ['21:16에는 어느 자리에 계셨습니까?', 'ASK_LOCATION_AT_TIME'],
    ['그날 있었던 일을 순서대로 말해 주세요.', 'ASK_TIMELINE'],
    ['당일 행적을 처음부터 설명해 주시겠습니까?', 'ASK_TIMELINE'],
    ['피해자와 어떤 관계였습니까?', 'ASK_RELATIONSHIP'],
    ['관장님과 사이가 안 좋았습니까?', 'ASK_RELATIONSHIP'],
    ['운송 상자를 옮긴 적 있습니까?', 'ASK_CRATE_MOVEMENT'],
    ['그 박스는 누가 움직였습니까?', 'ASK_CRATE_MOVEMENT'],
    ['카메라는 계속 가려져 있었습니까?', 'ASK_CAMERA_STATUS'],
    ['CCTV에 뭐가 찍혔습니까?', 'ASK_CAMERA_STATUS'],
    ['반입문 출입 기록은 어떻게 됩니까?', 'ASK_ACCESS_PANEL'],
    ['배지로 문을 연 사람이 누구입니까?', 'ASK_ACCESS_PANEL'],
    ['받침대 상태는 정상이었습니까?', 'ASK_PLINTH_CONDITION'],
    ['라벨을 누가 바꿨습니까?', 'ASK_LABEL_CHANGE'],
    ['목록대 표식이 왜 교체됐습니까?', 'ASK_LABEL_CHANGE'],
    ['수정 권한은 누구에게 있습니까?', 'ASK_REVISION_PERMISSION'],
    ['REV-17 세션은 누가 발급받았습니까?', 'ASK_REVISION_PERMISSION'],
    ['그 시간에 사적인 통화를 하셨습니까?', 'ASK_PRIVATE_ACTIVITY'],
    ['왜 그 사실을 먼저 말하지 않았습니까?', 'ASK_REASON_FOR_LIE'],
    ['아까는 다르게 말하셨는데요?', 'ASK_REASON_FOR_LIE'],
  ]
  for (const [q, want] of cases) {
    it(`${want} ← "${q}"`, () => expect(of(q)).toBe(want))
  }
})

describe('추궁은 화제가 없을 때만 추궁이다', () => {
  it('근거 없이 진술만 흔들면 CHALLENGE_CLAIM', () => {
    expect(of('그 말을 어떻게 증명하시겠습니까?')).toBe('CHALLENGE_CLAIM')
    expect(of('정말입니까? 믿을 수 없습니다.')).toBe('CHALLENGE_CLAIM')
  })

  it('추궁 어투에 화제가 붙으면 **화제가 이긴다** — 무엇을 답할지는 화제가 정한다', () => {
    expect(of('상자를 옮긴 게 정말 아닙니까?')).toBe('ASK_CRATE_MOVEMENT')
    expect(of('라벨을 바꾼 게 확실히 아니라고요?')).toBe('ASK_LABEL_CHANGE')
  })
})

describe('Clue 를 들이밀면 그것이 곧 의도다 (PRESENT_CLUE)', () => {
  it('제시한 Clue id 가 결과에 실린다 — 텍스트로 추측하지 않는다', () => {
    const r = classify('이 기록을 어떻게 설명하시겠습니까?', { ...ctx, presentedClueIds: ['E3'] })
    expect(r.intent).toBe('PRESENT_CLUE')
    expect(r.referencedClueIds).toEqual(['E3'])
    expect(r.confidence).toBe(1)
  })

  it('아무 문장이어도 제시가 있으면 제시다', () => {
    expect(classify('', { presentedClueIds: ['E9'] }).intent).toBe('PRESENT_CLUE')
  })
})

describe('시각 읽기 — 이 사건의 밤은 21시대다 (라벨은 사건이 소유한다)', () => {
  it('12시간제도 21시로 읽는다', () => {
    expect(readTime('9시 4분에 나갔습니까?', SLOT_LABELS)).toBe('21:00')
    expect(readTime('21시 16분에 어디 계셨습니까?', SLOT_LABELS)).toBe('21:16')
    expect(readTime('21:18에 무엇을 하셨습니까?', SLOT_LABELS)).toBe('21:18')
  })

  it('사건의 칸으로 스냅한다 — 9시쯤은 첫 칸이다', () => {
    expect(readTime('9시쯤 뭐 하고 있었어요?', SLOT_LABELS)).toBe('21:00')
    expect(readTime('아홉시 십분에는요?', SLOT_LABELS)).toBe('21:10')
  })

  it('칸에서 멀면 스냅하지 않는다 — 없는 시각을 사건의 칸으로 만들지 않는다', () => {
    expect(readTime('11시 40분에는요?', SLOT_LABELS)).toBe('23:40')
  })

  it('시각이 없으면 없다', () => {
    expect(readTime('어디 계셨습니까?', SLOT_LABELS)).toBeUndefined()
  })

  it('분류 결과에 정규화된 시각이 실린다', () => {
    expect(classify('9시 4분에 나갔습니까?', ctx).time).toBe('21:00')
  })
})

describe('다른 인물을 가리키는 질문', () => {
  it('이름이 나오면 subjectId 가 붙는다', () => {
    expect(classify('문소라는 그때 어디 있었습니까?', ctx).subjectId).toBe('S3')
    expect(classify('류나린이 나가는 걸 봤습니까?', ctx).subjectId).toBe('S1')
  })

  it('이름이 없으면 붙지 않는다 — 마주 앉은 사람에 대한 질문이다', () => {
    expect(classify('그때 어디 계셨습니까?', ctx).subjectId).toBeUndefined()
  })
})

describe('못 읽는 질문 — 실패가 아니라 상태다 (명세 §12)', () => {
  it('막연한 질문은 UNKNOWN 이거나 확신이 낮다', () => {
    const r = classify('그때 그거 어떻게 된 거예요?', ctx)
    expect(isVague(r)).toBe(true)
  })

  it('빈 질문도 던지지 않는다', () => {
    expect(classify('', ctx).intent).toBe('UNKNOWN')
  })

  it('사건과 무관한 질문도 조용히 UNKNOWN — 무료 재시도는 없다 (금지 6)', () => {
    const r = classify('점심 뭐 드셨어요?', ctx)
    expect(['UNKNOWN', 'ASK_PRIVATE_ACTIVITY']).toContain(r.intent)
  })
})

describe('결정론 — 같은 문장은 언제나 같은 의도다 (불변식 5)', () => {
  it('100번 돌려도 같은 결과', () => {
    const q = '21시 18분에 라벨을 바꾼 사람이 누구입니까?'
    const first = JSON.stringify(classify(q, ctx))
    for (let i = 0; i < 100; i++) expect(JSON.stringify(classify(q, ctx))).toBe(first)
  })
})
