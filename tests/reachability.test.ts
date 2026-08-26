/**
 * **플레이로 도달 가능한가** — 코드로만 성립하는 Proof 는 Proof 가 아니다 (AC-15·AC-06).
 *
 * `tests/proof.test.ts` 는 "이 Clue 들을 내면 PROVEN" 을 증명한다. 이 파일은 그보다 앞의 질문에
 * 답한다: **그 Clue 들을 실제로 손에 넣을 수 있는가.** 실측에서 이 구멍이 나왔다 —
 * 네 개의 Fact 가 심문 규칙에도 기록 표에도 없어서, Path B 가 테스트에서만 초록이었다.
 */
import { describe, expect, it } from 'vitest'
import {
  applyGc001Tension, discoverGc001Evidence, GC001_CLAIMS, GC001_EVIDENCE_FACTS, GC001_FACTS,
  gc001KnownFacts,
} from '../src/data/gc001-inquiry'
import { GC001_KNOWLEDGE } from '../src/data/gc001-knowledge'
import { GC001_CULPRIT_PROOF, GC001_METHOD_PROOF, GC001_PROPOSITIONS } from '../src/data/gc001-proof'
import { createInquiry, evidenceStateOf, hear, heldClueIds, learnFact } from '../src/engine/inquiry'
import { closeProof, validateProof, type ProofContext } from '../src/engine/proof'

/** 게임 안에서 그 Fact 를 얻을 수 있는 경로가 하나라도 있는가 */
const reachableFacts = (): Set<string> => {
  const out = new Set<string>(gc001KnownFacts().map((f) => f.id))
  for (const r of GC001_KNOWLEDGE) for (const f of r.availableFactIds ?? []) out.add(f)
  for (const list of Object.values(GC001_EVIDENCE_FACTS)) for (const f of list) out.add(f)
  return out
}

describe('모든 Fact 에는 얻는 길이 있다', () => {
  it('Fact 12건 전부가 심문이나 기록으로 손에 들어온다', () => {
    const reach = reachableFacts()
    const orphans = GC001_FACTS.filter((f) => !reach.has(f.id)).map((f) => f.id)
    expect(orphans, `얻을 방법이 없는 Fact: ${orphans.join(', ')}`).toEqual([])
  })

  it('기록이 알려주는 사실은 그 기록의 본문 범위 안이다 — 실재하는 Fact id 만', () => {
    const ids = new Set(GC001_FACTS.map((f) => f.id))
    for (const [ev, list] of Object.entries(GC001_EVIDENCE_FACTS)) {
      for (const f of list) expect(ids.has(f), `${ev} → ${f}`).toBe(true)
    }
  })
})

describe('모든 Claim 에는 듣는 길이 있다', () => {
  it('수정 진술을 포함해 모든 진술이 어떤 규칙에서든 나온다', () => {
    const spoken = new Set<string>()
    for (const r of GC001_KNOWLEDGE) {
      for (const id of [...(r.baseClaimIds ?? []), ...(r.defensiveClaimIds ?? []), ...(r.revisedClaimIds ?? [])]) {
        spoken.add(id)
      }
    }
    const orphans = GC001_CLAIMS.filter((c) => !spoken.has(c.id)).map((c) => c.id)
    expect(orphans, `들을 방법이 없는 진술: ${orphans.join(', ')}`).toEqual([])
  })
})

describe('기록 하나가 사실을 데려온다 (§8)', () => {
  it('E6 을 확보하면 문소라의 21:18 위치와 이동 시간 2분을 함께 안다', () => {
    const s = discoverGc001Evidence(createInquiry(), 'E6')
    expect(s.facts).toEqual(expect.arrayContaining([
      'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME',
    ]))
    expect(evidenceStateOf(s, 'E6')).toBe('DISCOVERED')
  })

  it('그 기록이 어떤 진술을 흔들었다면 의미가 파악된 것이다 (DISCOVERED → UNDERSTOOD)', () => {
    let s = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')   // "상자를 옮기지 않았다"
    s = discoverGc001Evidence(s, 'E3')                        // 상자 스캔 기록
    expect(s.claims['CLM-GC001-MUN-NO-MOVE']!.state).toBe('QUESTIONABLE')
    expect(evidenceStateOf(s, 'E3')).toBe('UNDERSTOOD')
  })

  it('흔들 진술이 없으면 기록은 확보 상태에 머문다 — 쥔 것과 아는 것은 다르다', () => {
    const s = discoverGc001Evidence(createInquiry(), 'E3')
    expect(evidenceStateOf(s, 'E3')).toBe('DISCOVERED')
  })
})

describe('AC-15 — 두 경로가 **플레이로** PROVEN 에 닿는다', () => {
  const ctxOf = (s: ReturnType<typeof createInquiry>): ProofContext => ({
    propositions: GC001_PROPOSITIONS,
    culpritProof: GC001_CULPRIT_PROOF,
    methodProof: GC001_METHOD_PROOF,
    held: heldClueIds(s),
    given: gc001KnownFacts().map((f) => f.id),
    claimStates: Object.fromEntries(Object.entries(s.claims).map(([id, t]) => [id, t.state])),
    revisionOf: Object.fromEntries(GC001_CLAIMS.filter((c) => c.revises).map((c) => [c.id, c.revises!])),
  })

  /**
   * Path B — **기록 조회 2회 + 심문뿐.** REV-17(E9)을 보지 않는다.
   *   ① E8 카메라 조각 → 21:18 라벨 교체
   *   ② E4 현장 판정 → 고의적 직접 물리력 분류
   *   ③ 문소라 심문 → 자격자 둘 + 21:18 반입대 + 이동 2분
   *   ④ 김하늘 심문 → 문 열림 ≠ 통과 → 류나린 재질문 → 고쳐 말한 진술
   */
  it('Path B — E9 없이, 기록 2장 + 심문으로 모인 근거가 PROVEN 이다', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    s = discoverGc001Evidence(s, 'E8')
    s = discoverGc001Evidence(s, 'E4')
    // 심문으로 얻는 것들 (규칙 엔진이 허용하는 것과 같은 id)
    for (const f of ['F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'F-GC001-DOOR-OPEN-NOT-PASSAGE']) {
      s = learnFact(s, f)
    }
    s = hear(s, 'CLM-GC001-MUN-LOADING')
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    s = applyGc001Tension(s)

    expect(heldClueIds(s)).not.toContain('E9')
    const r = validateProof({
      culpritId: 'S1',
      methodId: '고의적 직접 물리력',
      selectedClueIds: [
        'F-GC001-LABEL-CHANGED-2118',      // ← E8 이 데려온 사실
        'F-GC001-REVISION-OPERATOR-SCOPE',
        'CLM-GC001-MUN-LOADING',
        'F-GC001-MAIN-LOADING-TRAVEL-TIME',
        'CLM-GC001-RYU-LEFT-PRESSED',
        'E4',
      ],
      connections: [],
    }, ctxOf(s))
    expect(r.verdict).toBe('PROVEN')
  })

  /** Path A — 기록 중심. E8·E9·E6 을 열고 방식까지 세운다 */
  it('Path A — 기록으로 모은 근거가 PROVEN 이다', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    for (const ev of ['E8', 'E9', 'E6', 'E4', 'E7']) s = discoverGc001Evidence(s, ev)
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    const r = validateProof({
      culpritId: 'S1',
      methodId: '고의적 직접 물리력',
      selectedClueIds: ['E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4'],
      connections: [],
    }, ctxOf(s))
    expect(r.verdict).toBe('PROVEN')
  })

  it('두 경로의 성립 명제 집합은 같다 — 같은 Truth 에 닿는다 (AC-14)', () => {
    const a = closeProof(GC001_PROPOSITIONS, new Set([
      'E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED',
      'E4', 'F-GC001-CRIME-WINDOW',
    ]))
    const b = closeProof(GC001_PROPOSITIONS, new Set([
      'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE', 'CLM-GC001-MUN-LOADING',
      'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4', 'F-GC001-CRIME-WINDOW',
    ]))
    for (const need of ['PROP-01', 'PROP-02', 'PROP-03', 'PROP-04', 'PROP-05', 'PROP-06']) {
      expect(a.proven.has(need), `A: ${need}`).toBe(true)
      expect(b.proven.has(need), `B: ${need}`).toBe(true)
    }
  })
})
