/**
 * **Acceptance Criteria 15개 — 명세와 코드를 한 파일에서 맞댄다** (V0.2 §38).
 *
 * 개별 계약은 이미 각 계층의 테스트가 지킨다(inquiry·intent·knowledge·askPolicy·proof·
 * reachability·inquiryPanel). 이 파일은 그 위에 **색인**을 둔다 — 명세의 조항 번호로 찾아올 수
 * 있어야 다음 사람이 "AC-07 은 어디서 지켜지나" 를 30초 안에 답할 수 있다.
 *
 * 그래서 일부 검사는 다른 파일과 겹친다. **의도된 중복이다**: 명세는 문서이고 문서는 조항으로
 * 읽힌다. 조항 하나가 사라지면 여기서 붉어져야 한다.
 *
 * §39 의 금지 사항 6개도 함께 잠근다 — 금지는 "하지 않는다" 이므로 테스트가 없으면
 * 다음 사람이 조용히 되살린다.
 */
import { describe, expect, it } from 'vitest'
import { TALK_CAP } from '../src/data/config'
import { createGame, interview, talksLeft } from '../src/engine/game'
import { gc001Case } from '../src/data/gc001'
import { chargesQuestion } from '../src/engine/askPolicy'
import { classify } from '../src/engine/intent'
import { allowedResponse, FORBIDDEN_FACT_IDS, renderAllowedBlock, ruleFallbackSpeech } from '../src/engine/knowledge'
import { GC001_KNOWLEDGE } from '../src/data/gc001-knowledge'
import {
  applyGc001Tension, discoverGc001Evidence, GC001_CLAIMS, gc001Claim, gc001Fact, gc001KnownFacts,
} from '../src/data/gc001-inquiry'
import {
  createInquiry, hear, heldClueIds, learnFact, question, type ClaimState,
} from '../src/engine/inquiry'
import { validateProof, type ProofContext } from '../src/engine/proof'
import { GC001_CULPRIT_PROOF, GC001_METHOD_PROOF, GC001_PROPOSITIONS } from '../src/data/gc001-proof'
import { slotLabel, SLOTS, SUSPECTS } from '../src/types'

const chain = (ids: readonly string[]) => ids.slice(0, -1).map((fromId, i) => ({ fromId, toId: ids[i + 1]! }))

const CASE = gc001Case()
const ctx = {
  names: Object.fromEntries(Object.values(CASE.suspects).map((s) => [s.name, s.id])),
  slotLabels: SLOTS.map((t) => slotLabel(CASE, t)),
}
const look = { claim: (id: string) => gc001Claim(id)?.text, fact: (id: string) => gc001Fact(id)?.text }
const ask = (s: Parameters<typeof allowedResponse>[0]['suspectId'], intent: Parameters<typeof allowedResponse>[0]['intent'], o = {}) =>
  allowedResponse({ suspectId: s, intent, held: [], claimStates: {}, rules: GC001_KNOWLEDGE, ...o })

const proofCtx = (s: ReturnType<typeof createInquiry>): ProofContext => ({
  propositions: GC001_PROPOSITIONS,
  culpritProof: GC001_CULPRIT_PROOF,
  methodProof: GC001_METHOD_PROOF,
  held: heldClueIds(s),
  given: gc001KnownFacts().map((f) => f.id),
  claimStates: Object.fromEntries(Object.entries(s.claims).map(([id, t]) => [id, t.state])),
  revisionOf: Object.fromEntries(GC001_CLAIMS.filter((c) => c.revises).map((c) => [c.id, c.revises!])),
})

describe('AC-01 — 각 용의자는 최대 10회 질문 가능하다', () => {
  it('상한 10, 인물별로 따로 센다', () => {
    expect(TALK_CAP).toBe(10)
    let g = createGame(CASE)
    for (let i = 0; i < 10; i++) g = interview(g, 'S2')
    expect(talksLeft(g, 'S2')).toBe(0)
    expect(talksLeft(g, 'S1')).toBe(10)
  })
})

describe('AC-02 — 도움이 안 되는 질문도 정상 응답이면 1회 차감', () => {
  it('정상 응답과 규칙 응답 모두 차감한다', () => {
    expect(chargesQuestion({ fallback: false })).toBe(true)
    expect(chargesQuestion({ fallback: true, reason: 'verification_failed' })).toBe(true)
  })

  it('의도를 못 읽은 질문도 정상 응답이다 — 무료 재시도가 아니다 (§12)', () => {
    const r = classify('그때 그거 어떻게 된 거예요?', ctx)
    expect(ask('S1', r.intent, { confidence: r.confidence }).mode).toBe('CLARIFY')
    expect(chargesQuestion({ fallback: false })).toBe(true)
  })
})

describe('AC-03 — 시스템 오류는 차감하지 않는다', () => {
  for (const reason of ['no_key', 'rate_limited', 'bad_origin', 'AbortError', undefined]) {
    it(`${reason ?? '알 수 없는 실패'} → 환불`, () => {
      expect(chargesQuestion({ fallback: true, ...(reason ? { reason } : {}) })).toBe(false)
    })
  }
})

describe('AC-04 — 김하늘에게 E03 을 제시하지 않아도 카메라 조사로 갈 수 있다', () => {
  it('네 가지 근거 중 아무거나로 카메라 진술이 열린다', () => {
    for (const id of ['E3', 'E8', 'F-GC001-LABEL-CHANGED-2118', 'F-GC001-CRATE-MOVED-2109']) {
      expect(ask('S5', 'ASK_CAMERA_STATUS', { held: [id] }).mode, id).toBe('REVISE')
    }
  })
})

describe('AC-05 — 류나린에게 E05 를 제시하지 않아도 Revision 정보를 얻는다', () => {
  it('류나린과 문소라 모두 자격자 사실을 그냥 알려준다', () => {
    expect(ask('S1', 'ASK_REVISION_PERMISSION').factIds).toContain('F-GC001-REVISION-OPERATOR-SCOPE')
    expect(ask('S3', 'ASK_REVISION_PERMISSION').factIds).toContain('F-GC001-REVISION-OPERATOR-SCOPE')
  })

  it('E9(수정 라벨 기록)를 열어도 같은 사실에 닿는다 — 두 경로', () => {
    expect(discoverGc001Evidence(createInquiry(), 'E9').facts)
      .toContain('F-GC001-REVISION-OPERATOR-SCOPE')
  })
})

describe('AC-06 — REV-17-084 를 못 찾아도 Proof Path B 로 입증된다', () => {
  it('E9 없이 PROVEN', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    s = discoverGc001Evidence(s, 'E8')
    s = discoverGc001Evidence(s, 'E4')
    for (const f of ['F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MAIN-LOADING-TRAVEL-TIME']) s = learnFact(s, f)
    s = hear(s, 'CLM-GC001-MUN-LOADING')
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    expect(heldClueIds(s)).not.toContain('E9')
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력',
      selectedClueIds: [
        'F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE', 'CLM-GC001-MUN-LOADING',
        'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4',
      ],
      connections: chain(['F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE', 'CLM-GC001-MUN-LOADING', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4']),
    }, proofCtx(s))
    expect(r.verdict).toBe('PROVEN')
  })
})

describe('AC-07 — 문소라의 거짓말 해소가 필수 진행 열쇠가 아니다', () => {
  it('문소라의 수정 진술 없이도 Path B 가 선다 (위치 Fact 만 있으면 된다)', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    s = discoverGc001Evidence(s, 'E8')
    s = discoverGc001Evidence(s, 'E6')   // 반입대 작업 기록 → 위치 + 이동시간
    s = discoverGc001Evidence(s, 'E4')
    s = learnFact(s, 'F-GC001-REVISION-OPERATOR-SCOPE')
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    expect(s.claims['CLM-GC001-MUN-MOVED']).toBeUndefined()   // 문소라의 비밀을 안 풀었다
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력',
      selectedClueIds: [
        'E8', 'F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MUN-AT-LOADING-2118',
        'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4',
      ],
      connections: chain(['E8', 'F-GC001-REVISION-OPERATOR-SCOPE', 'F-GC001-MUN-AT-LOADING-2118', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4']),
    }, proofCtx(s))
    expect(r.verdict).toBe('PROVEN')
  })
})

describe('AC-08 — 류나린을 골랐다고 즉시 정답이 아니다', () => {
  it('동기와 의심만으로는 CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    s = learnFact(s, 'F-GC001-DISMISSAL-NOTICE')
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력',
      selectedClueIds: ['F-GC001-DISMISSAL-NOTICE', 'CLM-GC001-RYU-LEFT-PRESSED'],
      connections: chain(['F-GC001-DISMISSAL-NOTICE', 'CLM-GC001-RYU-LEFT-PRESSED']),
    }, proofCtx(s))
    expect(r.verdict).toBe('CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE')
  })
})

describe('AC-09 — 자백 없이 객관 Clue 만으로 클리어할 수 있다', () => {
  it('류나린의 어떤 진술도 자백이 아니다', () => {
    for (const c of GC001_CLAIMS.filter((x) => x.speaker === 'S1')) {
      for (const w of ['제가 죽였', '제가 했습니다', '자백']) expect(c.text).not.toContain(w)
    }
  })

  it('Path A 의 근거는 전부 기록·사실이다 (진술 하나는 퇴장 정정뿐)', () => {
    let s = createInquiry()
    for (const f of gc001KnownFacts()) s = learnFact(s, f.id)
    for (const ev of ['E8', 'E9', 'E6', 'E4']) s = discoverGc001Evidence(s, ev)
    s = hear(s, 'CLM-GC001-RYU-LEFT-PRESSED')
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력',
      selectedClueIds: ['E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4'],
      connections: chain(['E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4']),
    }, proofCtx(s))
    expect(r.verdict).toBe('PROVEN')
  })
})

describe('AC-10 — Evidence Unlock 없이도 심문에서 유의미한 정보가 나온다', () => {
  it('기록 0장으로 다섯 명에게서 사실·진술을 모을 수 있다', () => {
    const got: string[] = []
    for (const [s, intent] of [
      ['S5', 'ASK_ACCESS_PANEL'], ['S4', 'ASK_PLINTH_CONDITION'], ['S2', 'ASK_RELATIONSHIP'],
      ['S3', 'ASK_REVISION_PERMISSION'], ['S1', 'ASK_CRATE_MOVEMENT'],
    ] as const) {
      const r = ask(s, intent)
      got.push(...r.factIds, ...r.claimIds)
    }
    expect(got.length).toBeGreaterThanOrEqual(5)
    expect(new Set(got).size).toBeGreaterThanOrEqual(5)
  })
})

describe('AC-11 — "모릅니다" 만 반복하며 막히지 않는다', () => {
  it('다섯 명 모두 일반 화제에서 무언가를 내놓는다', () => {
    for (const s of SUSPECTS) {
      const yields = (['ASK_TIMELINE', 'ASK_LOCATION_AT_TIME', 'ASK_RELATIONSHIP'] as const)
        .some((i) => { const r = ask(s, i); return r.claimIds.length + r.factIds.length > 0 })
      expect(yields, `${s}`).toBe(true)
    }
  })
})

describe('AC-12 — 플레이어가 비교하기 전에 시스템이 확정하지 않는다', () => {
  it('충돌 가능 정보가 손에 들어와도 QUESTIONABLE 까지만 (거짓말 판정 없음)', () => {
    let s = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')
    s = discoverGc001Evidence(s, 'E3')
    expect(s.claims['CLM-GC001-MUN-NO-MOVE']!.state).toBe('QUESTIONABLE')
  })

  it('여러 번 다시 계산해도 스스로 CHALLENGED 로 오르지 않는다', () => {
    let s = hear(createInquiry(), 'CLM-GC001-RYU-LEFT')
    s = learnFact(s, 'F-GC001-DOOR-OPEN-NOT-PASSAGE')
    for (let i = 0; i < 5; i++) s = applyGc001Tension(s)
    expect(s.claims['CLM-GC001-RYU-LEFT']!.state).toBe('QUESTIONABLE')
  })
})

describe('AC-13 — AI 가 실패해도 규칙 기반으로 진행된다', () => {
  it('허용된 진술·사실이 있으면 그 문장이 대사가 된다', () => {
    expect(ruleFallbackSpeech(ask('S5', 'ASK_ACCESS_PANEL'), look))
      .toBe(gc001Claim('CLM-GC001-GIM-PANEL')!.text)
  })

  it('아무것도 없을 때도 사람이 할 말이 있다', () => {
    expect(ruleFallbackSpeech(ask('S4', 'ASK_LABEL_CHANGE'), look)).toBeTruthy()
  })
})

describe('AC-14 — 조사 순서가 달라도 같은 Truth 다', () => {
  it('기록을 반대 순서로 열어도 상태가 같다', () => {
    const order1 = ['E3', 'E8', 'E6']
    const order2 = ['E6', 'E8', 'E3']
    const run = (order: string[]) => {
      let s = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')
      s = hear(s, 'CLM-GC001-GIM-BLOCKED')
      for (const ev of order) s = discoverGc001Evidence(s, ev)
      return {
        facts: [...s.facts].sort(),
        claims: Object.fromEntries(Object.entries(s.claims).map(([k, v]) => [k, v.state])),
        evidence: Object.fromEntries(Object.entries(s.evidence).sort()),
      }
    }
    expect(run(order1)).toEqual(run(order2))
  })

  it('Truth 는 데이터에 고정돼 있다 — 범인·시각·수단', () => {
    expect(CASE.culprit).toBe('S1')
    expect(slotLabel(CASE, 2)).toBe('21:16')
    expect(CASE.weapon).toBe('고의적 직접 물리력')
  })
})

describe('AC-15 — 서로 다른 두 Proof Path 가 PROVEN 에 닿는다', () => {
  it('tests/proof.test.ts 와 tests/reachability.test.ts 가 각각 A·B 를 증명한다', () => {
    // 이 항목은 위 두 파일이 실제로 검증한다. 여기서는 **두 경로가 다른 근거를 쓴다**는
    // 사실만 확인한다 — 같은 근거를 쓰면 "두 경로" 가 아니다.
    const A = new Set(['E8', 'E9', 'E6', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4'])
    const B = new Set(['F-GC001-LABEL-CHANGED-2118', 'F-GC001-REVISION-OPERATOR-SCOPE',
      'CLM-GC001-MUN-LOADING', 'F-GC001-MAIN-LOADING-TRAVEL-TIME', 'CLM-GC001-RYU-LEFT-PRESSED', 'E4'])
    const onlyA = [...A].filter((x) => !B.has(x))
    const onlyB = [...B].filter((x) => !A.has(x))
    expect(onlyA.length).toBeGreaterThanOrEqual(2)
    expect(onlyB.length).toBeGreaterThanOrEqual(2)
    expect(onlyA).toContain('E9')      // A 만 REV-17 을 쓴다
  })
})

/* ────────────────────────────── §39 금지 사항 ────────────────────────────── */

describe('§39 금지 1 — Evidence A 획득이 Evidence B 를 생성하지 않는다', () => {
  it('규칙 표의 어떤 줄도 기록을 만들지 않는다 (claim·fact 만 낸다)', () => {
    for (const r of GC001_KNOWLEDGE) {
      for (const id of [...(r.baseClaimIds ?? []), ...(r.revisedClaimIds ?? []), ...(r.defensiveClaimIds ?? [])]) {
        expect(/^E\d+$/.test(id), `${r.suspectId} → ${id}`).toBe(false)
      }
      for (const id of r.availableFactIds ?? []) expect(/^E\d+$/.test(id)).toBe(false)
    }
  })
})

describe('§39 금지 2 — 정확한 Evidence 를 정확한 NPC 에게 내밀어야 다음 단계로 가는 구조가 없다', () => {
  it('수정 진술의 문은 전부 any-of 이거나 추궁으로 열린다', () => {
    for (const r of GC001_KNOWLEDGE) {
      if (!r.revisedClaimIds?.length) continue
      const routes = r.requiredContextIds?.length ?? 0
      const byChallenge = (r.defensiveClaimIds?.length ?? 0) + (r.baseClaimIds?.length ?? 0) > 0
      expect(routes >= 2 || byChallenge, `${r.suspectId}/${r.intent}`).toBe(true)
    }
  })
})

describe('§39 금지 3 — REV-17 발견이 범인을 자동 확정하지 않는다', () => {
  it('E9 만으로는 PROP-05 가 서지 않는다', () => {
    const s = discoverGc001Evidence(createInquiry(), 'E9')
    const r = validateProof({
      culpritId: 'S1', methodId: '고의적 직접 물리력',
      selectedClueIds: ['E9', 'F-GC001-REV17-ISSUED-2111'], connections: chain(['E9', 'F-GC001-REV17-ISSUED-2111']),
    }, proofCtx(s))
    expect(r.culpritProven).toBe(false)
    expect(r.verdict).not.toBe('PROVEN')
  })
})

describe('§39 금지 4 — Claim 과 Evidence 충돌을 시스템이 거짓말로 판정하지 않는다', () => {
  it('충돌은 QUESTIONABLE 이고, DISPROVED 는 사람이 추궁한 뒤에만 온다', () => {
    let s = hear(createInquiry(), 'CLM-GC001-GIM-BLOCKED')
    s = discoverGc001Evidence(s, 'E8')
    expect(s.claims['CLM-GC001-GIM-BLOCKED']!.state).toBe('QUESTIONABLE')
    expect(question(s, 'CLM-GC001-GIM-BLOCKED', ['E8']).claims['CLM-GC001-GIM-BLOCKED']!.state)
      .toBe('QUESTIONABLE')
  })
})

describe('§39 금지 5 — AI 가 새 사건 Fact 를 만들지 않는다', () => {
  it('프롬프트 블록에는 허용된 문장만 실리고 금지 사실은 id 조차 없다', () => {
    const a = ask('S1', 'ASK_DEPARTURE')
    const block = renderAllowedBlock(a, look)
    for (const id of FORBIDDEN_FACT_IDS) expect(block).not.toContain(id)
    expect(block).toContain(gc001Claim('CLM-GC001-RYU-LEFT')!.text)
  })

  it('허용 목록은 그 인물의 것만 담는다 — 남의 진술이 새지 않는다', () => {
    for (const s of SUSPECTS) {
      for (const intent of ['ASK_TIMELINE', 'ASK_LOCATION_AT_TIME', 'ASK_RELATIONSHIP'] as const) {
        for (const id of ask(s, intent).claimIds) {
          expect(gc001Claim(id)!.speaker, `${s}/${intent} → ${id}`).toBe(s)
        }
      }
    }
  })
})

describe('§39 금지 6 — 잘못된 질문에 무료 재시도를 주지 않는다', () => {
  it('CLARIFY 로 되물어도 비용은 발생한다', () => {
    const r = classify('음 그거요', ctx)
    expect(ask('S1', r.intent, { confidence: r.confidence }).mode).toBe('CLARIFY')
    expect(chargesQuestion({ fallback: false })).toBe(true)
  })
})
