/**
 * 증명 계층 — **두 경로가 모두 PROVEN 에 닿는가** (명세 V0.2 §24~§34, AC-06·08·09·15).
 *
 * 이 파일이 이 저장소에서 가장 중요한 테스트 중 하나다: 명세가 요구하는 **두 개의 서로 다른
 * Proof Path** 가 실제로 통과하고, 불완전한 논증이 통과하지 않는 것을 여기서 증명한다.
 */
import { describe, expect, it } from 'vitest'
import { closeProof, validateProof, VERDICT_LINE, type DeductionSubmission, type ProofContext } from '../src/engine/proof'
import {
  GC001_CLUE_PICK, GC001_CULPRIT_PROOF, GC001_METHOD_PROOF, GC001_PROPOSITIONS,
} from '../src/data/gc001-proof'
import type { ClaimState } from '../src/engine/inquiry'

const ctxOf = (held: string[], claimStates: Record<string, ClaimState> = {}): ProofContext => ({
  propositions: GC001_PROPOSITIONS,
  culpritProof: GC001_CULPRIT_PROOF,
  methodProof: GC001_METHOD_PROOF,
  held,
  // 브리핑 전제 — 실제 게임과 같은 값(gc001KnownFacts)
  given: ['F-GC001-CRIME-WINDOW'],
  claimStates,
  revisionOf: {
    'CLM-GC001-MUN-MOVED': 'CLM-GC001-MUN-NO-MOVE',
    'CLM-GC001-GIM-MISSED-FRAME': 'CLM-GC001-GIM-BLOCKED',
    'CLM-GC001-RYU-LEFT-PRESSED': 'CLM-GC001-RYU-LEFT',
    'CLM-GC001-BAE-CALL': 'CLM-GC001-BAE-CATALOG',
    'CLM-GC001-DO-REPORT-PLEA': 'CLM-GC001-DO-NO-DISPUTE',
  },
})

const submit = (clues: string[], culpritId = 'S1', methodId = '고의적 직접 물리력'): DeductionSubmission => ({
  culpritId,
  methodId,
  selectedClueIds: clues,
  // 연결은 화면이 만든 사슬이다. 판정은 명제로 하므로 여기서는 순서만 남긴다.
  connections: clues.slice(0, -1).map((from, i) => ({ fromId: from, toId: clues[i + 1]! })),
})

/* ────────────────────────────── Proof Path A — Serial 중심 ────────────────────────────── */

describe('AC-15 · Proof Path A — 카메라 조각 + REV-17 + 문소라 위치', () => {
  const clues = [
    'E8',                                   // 21:18 라벨 교체 (카메라 조각)
    'E9',                                   // REV-17-084 발급 기록 → 자격 제한
    'E6',                                   // 문소라 21:18 반입대 작업
    'F-GC001-MAIN-LOADING-TRAVEL-TIME',     // 최소 이동 2분
    'CLM-GC001-RYU-LEFT-PRESSED',           // 퇴장 주장을 고쳐 말했다 → 기회
    'F-GC001-CRIME-WINDOW',                 // 범행 시간대
  ]
  const held = [...clues, 'E4', 'F-GC001-PLINTH-OK-2040', 'F-GC001-DEATH-CLASSIFICATION']

  it('명제 05·06 이 서고, 방식까지 갖추면 PROVEN', () => {
    const r = validateProof(submit([...clues, 'E4'].slice(0, 6)), ctxOf(held))
    // 6개 상한 안에서 범인 축이 선다
    expect(r.proven).toEqual(expect.arrayContaining(['PROP-02', 'PROP-03', 'PROP-04', 'PROP-05', 'PROP-06']))
    expect(r.culpritProven).toBe(true)
  })

  it('방식 근거(현장 판정)를 함께 내면 PROVEN 이다', () => {
    // PROP-01 은 E4 하나로 선다 — 근거 5개로 두 축을 모두 세운다
    const r = validateProof(submit([
      'E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4',
    ]), ctxOf([...held, 'E4']))
    expect(r.verdict).toBe('PROVEN')
    expect(r.methodProven).toBe(true)
  })
})

/* ────────────────────────────── Proof Path B — 권한·위치 중심 ────────────────────────────── */

describe('AC-06·AC-15 · Proof Path B — REV-17 없이도 입증된다', () => {
  const clues = [
    'F-GC001-LABEL-CHANGED-2118',           // 21:18 라벨이 바뀌었다
    'F-GC001-REVISION-OPERATOR-SCOPE',      // 자격자는 둘
    'F-GC001-MUN-AT-LOADING-2118',          // 문소라는 그 시각 반입대
    'F-GC001-MAIN-LOADING-TRAVEL-TIME',     // 2분
    'CLM-GC001-RYU-LEFT-PRESSED',           // 기회
    'E4',                                   // 방식
  ]
  const held = [...clues, 'F-GC001-CRIME-WINDOW', 'F-GC001-DOOR-OPEN-NOT-PASSAGE']

  it('REV-17-084(E9)를 한 번도 보지 않고 PROVEN 에 닿는다', () => {
    const r = validateProof(submit(clues), ctxOf(held))
    expect(clues).not.toContain('E9')
    expect(held).not.toContain('E9')
    expect(r.verdict).toBe('PROVEN')
    expect(r.proven).toEqual(expect.arrayContaining(['PROP-05', 'PROP-06', 'PROP-01']))
  })

  it('문소라 배제가 빠지면 PROP-05 가 서지 않는다 — 대리 사용 가능성이 남는다', () => {
    const without = clues.filter((c) => c !== 'F-GC001-MUN-AT-LOADING-2118')
    const r = validateProof(submit(without), ctxOf(held))
    expect(r.proven).not.toContain('PROP-04')
    expect(r.proven).not.toContain('PROP-05')
    expect(r.culpritProven).toBe(false)
  })

  it('이동 시간 Fact 가 없으면 위치만으로는 배제되지 않는다', () => {
    const without = clues.filter((c) => c !== 'F-GC001-MAIN-LOADING-TRAVEL-TIME')
    const r = validateProof(submit(without), ctxOf(held))
    expect(r.proven).not.toContain('PROP-04')
  })
})

/* ────────────────────────────── 불완전한 Proof (§30) ────────────────────────────── */

describe('§30 · 불완전한 Proof 는 통과하지 않는다', () => {
  it('Case A — 동기 + 퇴장 의심만: 수상함 ≠ 증명 (AC-08)', () => {
    const clues = ['F-GC001-DISMISSAL-NOTICE', 'CLM-GC001-RYU-LEFT-PRESSED', 'F-GC001-CRIME-WINDOW']
    const r = validateProof(submit(clues), ctxOf([...clues, 'E4']))
    expect(r.proven).toContain('PROP-07')
    expect(r.proven).toContain('PROP-06')   // 기회는 섰다
    expect(r.proven).not.toContain('PROP-05')
    expect(r.verdict).toBe('CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE')
    expect(r.reasons.join(' ')).toContain('다른 가능성이 남아')
  })

  it('Case B — 카메라 조각만: 은폐는 확인되지만 행위자를 특정하지 못한다', () => {
    const r = validateProof(submit(['E8', 'F-GC001-CRIME-WINDOW']), ctxOf(['E8', 'F-GC001-CRIME-WINDOW']))
    expect(r.proven).toContain('PROP-02')
    expect(r.culpritProven).toBe(false)
    expect(['UNPROVEN', 'CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE']).toContain(r.verdict)
  })

  it('Case C — REV-17 만: 류나린을 강하게 지지하지만 대리 가능성이 남는다', () => {
    const r = validateProof(submit(['E9', 'E8']), ctxOf(['E9', 'E8']))
    expect(r.proven).toEqual(expect.arrayContaining(['PROP-02', 'PROP-03']))
    expect(r.proven).not.toContain('PROP-05')
    expect(r.culpritProven).toBe(false)
  })

  it('Case D — 문소라의 거짓말만: 살인과 연결되지 않는다 (AC-07)', () => {
    const clues = ['E3', 'CLM-GC001-MUN-MOVED']
    const r = validateProof(submit(clues, 'S3'), ctxOf(clues))
    expect(r.culpritProven).toBe(false)
    expect(r.verdict).toBe('UNPROVEN')
  })

  it('범인을 맞혀도 근거가 없으면 즉시 정답이 아니다 (AC-08)', () => {
    const r = validateProof(submit(['F-GC001-DISMISSAL-NOTICE']), ctxOf(['F-GC001-DISMISSAL-NOTICE']))
    expect(r.culpritProven).toBe(false)
    expect(r.verdict).not.toBe('PROVEN')
  })
})

describe('§34 · Verdict 다섯 갈래', () => {
  it('METHOD_UNPROVEN — 범인 축은 섰고 방식만 빈다', () => {
    const clues = [
      'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE',
      'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
      'CLM-GC001-RYU-LEFT-PRESSED', 'F-GC001-CRIME-WINDOW',
    ]
    const r = validateProof(submit(clues), ctxOf(clues))
    expect(r.culpritProven).toBe(true)
    expect(r.methodProven).toBe(false)
    expect(r.verdict).toBe('METHOD_UNPROVEN')
  })

  it('CONTRADICTORY_PROOF — 어긋난 진술을 근거로 냈다', () => {
    const clues = ['CLM-GC001-MUN-NO-MOVE', 'E3']
    const r = validateProof(submit(clues), ctxOf(clues, { 'CLM-GC001-MUN-NO-MOVE': 'DISPROVED' }))
    expect(r.verdict).toBe('CONTRADICTORY_PROOF')
  })

  it('CONTRADICTORY_PROOF — 원본과 고친 말을 함께 냈다', () => {
    const clues = ['CLM-GC001-MUN-NO-MOVE', 'CLM-GC001-MUN-MOVED']
    const r = validateProof(submit(clues), ctxOf(clues))
    expect(r.verdict).toBe('CONTRADICTORY_PROOF')
  })

  it('UNPROVEN — 다른 사람을 골랐고 근거도 이어지지 않는다', () => {
    const r = validateProof(submit(['E8', 'E9'], 'S4'), ctxOf(['E8', 'E9']))
    expect(r.verdict).toBe('UNPROVEN')
  })

  it('모든 Verdict 에 사람이 읽을 한 줄이 있고, 정답을 말하지 않는다', () => {
    for (const [v, line] of Object.entries(VERDICT_LINE)) {
      expect(line.length).toBeGreaterThan(8)
      expect(line, v).not.toContain('류나린')
    }
  })
})

describe('경계와 위생', () => {
  it('손에 없는 근거는 셈에서 빠진다 — 화면이 그 사실을 말한다', () => {
    const r = validateProof(submit(['E8', 'E9']), ctxOf(['E8']))
    expect(r.ignored).toEqual(['E9'])
    expect(r.reasons.join(' ')).toContain('확보하지 않은 근거')
  })

  it('빈 규칙으로 명제가 공짜가 되지 않는다', () => {
    const { proven } = closeProof([{ id: 'X', statement: 'x', supportRules: [{}] }], new Set())
    expect(proven.size).toBe(0)
  })

  it('Closure 는 반복이 필요해도 닫힌다 (PROP-05 는 세 명제 뒤에 선다)', () => {
    const { proven } = closeProof(GC001_PROPOSITIONS, new Set([
      'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE',
      'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
    ]))
    expect(proven.has('PROP-05')).toBe(true)
  })

  it('AC-14 — 같은 근거는 순서가 달라도 같은 판정이다', () => {
    const clues = [
      'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE',
      'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
      'CLM-GC001-RYU-LEFT-PRESSED', 'E4',
    ]
    const a = validateProof(submit(clues), ctxOf(clues))
    const b = validateProof(submit([...clues].reverse()), ctxOf(clues))
    expect(a.verdict).toBe(b.verdict)
    expect([...a.proven].sort()).toEqual([...b.proven].sort())
  })

  it('근거 개수 정책은 최소 2 · 권장 4 · 상한 6', () => {
    expect(GC001_CLUE_PICK).toEqual({ min: 2, recommended: 4, max: 6 })
  })

  it('명제 표는 정본의 일곱 명제다', () => {
    expect(GC001_PROPOSITIONS.map((p) => p.id))
      .toEqual(['PROP-01', 'PROP-02', 'PROP-03', 'PROP-04', 'PROP-05', 'PROP-06', 'PROP-07'])
  })

  it('동기(PROP-07)는 범인 입증의 필수조건이 아니다 — 동기 존재 ≠ 범인 증명', () => {
    expect(GC001_CULPRIT_PROOF.requires).not.toContain('PROP-07')
  })
})

describe('§33 ② · Clue Connection 은 장식이 아니다', () => {
  it('명제를 만족하는 단서가 함께 있어도 연결이 없으면 UNPROVEN', () => {
    const clues = [
      'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE',
      'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
      'CLM-GC001-RYU-LEFT-PRESSED', 'E4',
    ]
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력', selectedClueIds: clues, connections: [],
    }, ctxOf(clues))
    expect(r.verdict).toBe('UNPROVEN')
    expect(r.proven).toEqual([])
    expect(r.reasons.join(' ')).toContain('연결이 끊어져')
  })

  it('일부만 이어 고립된 근거가 있어도 명제가 서지 않는다', () => {
    const clues = ['E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4']
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력', selectedClueIds: clues,
      connections: [{ fromId: 'E8', toId: 'E9' }, { fromId: 'E9', toId: 'E6' }],
    }, ctxOf(clues))
    expect(r.verdict).toBe('UNPROVEN')
  })
})
