import { describe, it, expect } from 'vitest'
import { gc001Case } from '../src/data/gc001'
import { validateCase } from '../src/engine/validate'
import { candidatesFrom } from '../src/engine/solver'
import {
  availableEvidence, createGame, lookupEvidence, presentEvidence, submit,
} from '../src/engine/game'
import { CRIME_SLOT, SUSPECTS } from '../src/types'

/**
 * GC001 「옮겨진 상자의 사각」 — 어댑테이션 계약 §4 의 검증 6종.
 * 수제 사건은 생성기의 재시도 그물이 없다 — 여기 테스트가 그 그물이다.
 */

const C = gc001Case()

describe('GC001 ① 검증기 V1~V7 통과', () => {
  const v = validateCase(C)

  it('전 항목 통과 — 수제 사건도 생성 사건과 같은 검증을 지난다', () => {
    expect(v.violations).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('최소 조사 수 m*가 3~5 다 (고정 사건의 V5)', () => {
    expect(v.solve.minActions).toBeGreaterThanOrEqual(3)
    expect(v.solve.minActions).toBeLessThanOrEqual(5)
  })
})

describe('GC001 ② 후보 전이 — 정본 §15 의 소거 사슬', () => {
  it('조사 0회: 후보 5명', () => {
    expect(candidatesFrom(C, new Set())).toHaveLength(5)
  })

  it('범행 시각(21:16) 기록 전부 조회: {류나린, 배지호, 문소라} 가 남는다', () => {
    const slot2 = C.evidence.filter((e) => e.slot === CRIME_SLOT).map((e) => e.id)
    const cands = candidatesFrom(C, new Set(slot2))
    expect(cands.sort()).toEqual(['S1', 'S2', 'S3'])   // 류나린·배지호·문소라
  })

  it('결정적 기록(E9)까지 쥐면 류나린 한 명으로 좁혀진다 — 은폐 시각(slot3) 기록이 못박는다', () => {
    const slot2 = C.evidence.filter((e) => e.slot === CRIME_SLOT).map((e) => e.id)
    const cands = candidatesFrom(C, new Set([...slot2, C.decisiveEvidenceId]))
    expect(cands).toEqual([C.culprit])
    expect(C.culprit).toBe('S1')
    // 이 사건의 구조적 차이를 못박는다: 결정적 기록은 범행 시각이 아니다
    const d = C.evidence.find((e) => e.decisive)!
    expect(d.slot).not.toBe(CRIME_SLOT)
  })
})

describe('GC001 ③ 결정적 기록의 해금 사슬 — 두 반쪽 연결 (정본 C-03)', () => {
  it('E6(반입대 작업)과 E8(카메라 조각)을 다 쥐기 전에는 잠겨 있고, 갖추면 열린다', () => {
    let g = createGame(C)
    const ids = () => availableEvidence(g).map((e) => e.id)

    // 시작: E8 은 김하늘의 인정(T-GIM-FRAME) 뒤에, E9 는 E8+E6 뒤에 있다
    expect(ids()).not.toContain('E8')
    expect(ids()).not.toContain('E9')

    g = lookupEvidence(g, 'E6')                       // 반쪽 하나 — 아직 잠김
    expect(ids()).not.toContain('E9')

    g = presentEvidence(g, 'E6', 'S5')                // 김하늘이 놓친 시야를 인정한다
    expect(g.cards).toContain('T-GIM-FRAME')
    expect(ids()).toContain('E8')                     // 카메라 조각이 열렸다
    expect(ids()).not.toContain('E9')                 // 그러나 대조는 아직이다

    g = lookupEvidence(g, 'E8')                       // 반쪽 둘
    expect(ids()).toContain('E9')                     // 이제 라벨 대조가 열린다
    g = lookupEvidence(g, 'E9')
    expect(g.cards).toContain('E9')
    expect(candidatesFrom(C, new Set(g.cards))).toEqual(['S1'])
  })

  it('현장 예산 소진 후에도 해금된 E8·E9 는 무료로 조회된다 — 통찰 보너스의 생존 조건', () => {
    let g = createGame(C)
    // 현장 챕터: 즉시 조회 기록으로 예산을 다 쓴다 (E6 포함)
    for (const id of ['E4', 'E2', 'E7', 'E3', 'E6']) g = lookupEvidence(g, id)
    expect(g.investigationsLeft).toBe(0)

    g = presentEvidence(g, 'E6', 'S5')                // 심문 챕터의 대화
    g = lookupEvidence(g, 'E8')                       // 무료
    g = lookupEvidence(g, 'E9')                       // 무료
    expect(g.investigationsLeft).toBe(0)
    expect(g.cards).toContain('E9')
  })
})

describe('GC001 ④ 3축 채점 — (류나린, 발각·해임 동기, 고의적 직접 물리력)', () => {
  it('정답 3축 + 결정적 기록 확보면 100점 구성이 된다', () => {
    const base = { ...createGame(C), investigationsLeft: 0 }
    const g = { ...base, cards: [...base.cards, C.decisiveEvidenceId] }
    const r = submit(g, { culprit: 'S1', motive: C.motive, weapon: '고의적 직접 물리력' })
    expect(r.correct).toEqual({ culprit: true, motive: true, weapon: true })
    expect(r.total).toBe(100)
  })

  it('정답 동기는 류나린의 사정이고, 정답 수단은 선택지 목록 안에 있다', () => {
    expect(C.motive).toBe(C.suspects.S1.motive)
    expect(C.world?.weaponOptions).toContain(C.weapon)
    // 동기도 다섯이 서로 달라야 익명 나열이 성립한다
    expect(new Set(SUSPECTS.map((s) => C.suspects[s].motive)).size).toBe(5)
  })
})

describe('GC001 ⑤ 유일해 붕괴 확인 — 정본 §15.8', () => {
  it('결정적 기록을 제거하면 나머지 전부를 쥐어도 후보 3명이 유지된다', () => {
    const others = C.evidence.filter((e) => !e.decisive).map((e) => e.id)
    const cands = candidatesFrom(C, new Set(others))
    expect(cands.sort()).toEqual(['S1', 'S2', 'S3'])
  })
})

describe('GC001 ⑥ 수단·신체·도구 묘사 금지 — 정본 §4 금칙어 스캔', () => {
  /**
   * '피' 는 단독으로만 금칙이다 — '피해자'·'피하려' 같은 정상 어휘를 오탐하면
   * 테스트가 늑대소년이 된다. 한글 앞뒤 문맥으로 거른다.
   */
  const FORBIDDEN = ['촛대', '허리띠', '재떨이', '칼', '찔', '목졸', '혈흔', '자창', '두부'] as const
  const BLOOD = /(?<![가-힣])피(?![가-힣])/

  const corpus = [
    JSON.stringify(gc001Case()),           // 데이터 전체 (라벨·비고·증언·궤적)
    C.ending!.confession,                  // 자백
    ...C.ending!.beats.map(([, t]) => t),  // 5단계 재구성
    C.world!.autopsyText!,                 // 현장 판정
  ].join('\n')

  it('도구명·신체·유혈 어휘가 없다', () => {
    for (const w of FORBIDDEN) expect(corpus, w).not.toContain(w)
    expect(BLOOD.test(corpus)).toBe(false)
  })

  it('호텔 어휘가 새지 않는다 — 월드 라벨 간접화의 목적', () => {
    for (const w of ['호텔', '1204', '카드키', '로비', '직원계단']) {
      expect(corpus, w).not.toContain(w)
    }
  })
})
