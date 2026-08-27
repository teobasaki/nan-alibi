import { describe, it, expect } from 'vitest'
import { gc001Case } from '../src/data/gc001'
import { validateCase } from '../src/engine/validate'
import { candidatesFrom } from '../src/engine/solver'
import {
  availableEvidence, createGame, lockedRecords, lookupEvidence, presentEvidence, submit,
} from '../src/engine/game'
import { CRIME_SLOT, SUSPECTS } from '../src/types'

/**
 * GC001 「갤러리의 사각지대」 — 어댑테이션 계약 §4 의 검증 6종.
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

describe('GC001 ③ V0.2 — 기록은 독립 조사 대상이고, 제시는 선택적 진술 경로다', () => {
  it('시작부터 E8·E9 를 포함한 기록 9건이 모두 조회 후보에 있다', () => {
    const g = createGame(C)
    const ids = availableEvidence(g).map((e) => e.id)
    expect(ids).toHaveLength(9)
    expect(ids).toEqual(expect.arrayContaining(['E8', 'E9']))
    expect(lockedRecords(g)).toEqual([])
  })

  it('김하늘 인정이나 E6·E8 선행 없이 E8·E9 를 직접 조사할 수 있다', () => {
    const g0 = createGame(C)
    expect(g0.cards).not.toContain('T-GIM-FRAME')
    const withCamera = lookupEvidence(g0, 'E8')
    expect(withCamera.cards).toContain('E8')
    expect(withCamera.investigationsLeft).toBe(g0.investigationsLeft - 1)

    const withRevision = lookupEvidence(g0, 'E9')
    expect(withRevision.cards).toContain('E9')
    expect(withRevision.cards).not.toContain('E6')
    expect(withRevision.cards).not.toContain('E8')
  })

  it('제시 반응은 진술을 주지만 이미 보이던 Evidence의 필수 열쇠는 아니다', () => {
    let g = createGame(C)
    expect(availableEvidence(g).map((e) => e.id)).toContain('E8')
    g = lookupEvidence(g, 'E6')
    g = presentEvidence(g, 'E6', 'S5')
    expect(g.cards).toContain('T-GIM-FRAME')
    expect(availableEvidence(g).map((e) => e.id)).toEqual(expect.arrayContaining(['E8', 'E9']))
  })

  it('open 기록도 예산을 다 쓰고 나면 무료가 아니다 — 획득 순서만 자유롭다', () => {
    let g = createGame(C)
    for (const id of ['E1', 'E2', 'E3', 'E4', 'E5']) g = lookupEvidence(g, id)
    expect(g.investigationsLeft).toBe(0)
    expect(() => lookupEvidence(g, 'E8')).toThrow(/예산/)
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
