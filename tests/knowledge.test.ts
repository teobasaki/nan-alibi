/**
 * 지식 규칙 엔진 — **심문에서 정보가 나오는가** (명세 V0.2 §16~§19, AC-10·AC-11·AC-13).
 *
 * 이 파일이 잠그는 것은 팀 3-3-(5) 의 지적 그 자체다:
 * *"모든 질문에서 정보를 숨기거나 모호하게 답한다면 플레이어가 새로운 사실을 얻을 방법이 없다."*
 */
import { describe, expect, it } from 'vitest'
import {
  allowedResponse, FORBIDDEN_FACT_IDS, renderAllowedBlock, ruleFallbackSpeech,
  type AllowedInput, type ClueTextLookup,
} from '../src/engine/knowledge'
import { GC001_KNOWLEDGE } from '../src/data/gc001-knowledge'
import { gc001Claim, gc001Fact, GC001_CLAIMS, GC001_FACTS } from '../src/data/gc001-inquiry'
import type { ClaimState } from '../src/engine/inquiry'
import type { QuestionIntent } from '../src/engine/intent'
import { SUSPECTS, type SuspectId } from '../src/types'

const look: ClueTextLookup = {
  claim: (id) => gc001Claim(id)?.text,
  fact: (id) => gc001Fact(id)?.text,
}

const ask = (
  suspectId: SuspectId,
  intent: QuestionIntent,
  o: Partial<AllowedInput> = {},
): ReturnType<typeof allowedResponse> => allowedResponse({
  suspectId, intent, held: [], claimStates: {}, rules: GC001_KNOWLEDGE, ...o,
})

describe('AC-11 — 숨길 이유가 없는 일반 사실은 그냥 답한다', () => {
  it('김하늘은 문 열림이 통과를 뜻하지 않는다는 규격을 알려준다 (IQ03 의 입구)', () => {
    const r = ask('S5', 'ASK_ACCESS_PANEL')
    expect(r.mode).toBe('ANSWER')
    expect(r.factIds).toContain('F-GC001-DOOR-OPEN-NOT-PASSAGE')
  })

  it('도율은 20:40 받침대 정상 확인을 말한다 (IQ01 — 사고설 약화)', () => {
    const r = ask('S4', 'ASK_PLINTH_CONDITION')
    expect(r.mode).toBe('ANSWER')
    expect(r.factIds).toContain('F-GC001-PLINTH-OK-2040')
  })

  it('배지호는 관계를 물으면 해임 통지를 말한다 (동기 가설의 시작)', () => {
    const r = ask('S2', 'ASK_RELATIONSHIP')
    expect(r.claimIds).toContain('CLM-GC001-BAE-NOTICE')
    expect(r.factIds).toContain('F-GC001-DISMISSAL-NOTICE')
  })

  it('류나린도 자기에게 불리하지 않은 사실은 먼저 말한다 — 수정 권한 자격자는 둘이다', () => {
    const r = ask('S1', 'ASK_REVISION_PERMISSION')
    expect(r.factIds).toContain('F-GC001-REVISION-OPERATOR-SCOPE')
  })

  it('문소라는 21:18 위치와 이동 시간을 그냥 말한다 (Proof Path B 의 두 축)', () => {
    const r = ask('S3', 'ASK_LOCATION_AT_TIME')
    expect(r.claimIds).toContain('CLM-GC001-MUN-LOADING')
    expect(r.factIds).toContain('F-GC001-MAIN-LOADING-TRAVEL-TIME')
  })

  it('숨기는 화제(DEFLECT)에서도 객관 사실은 나온다 — 대화가 벽이 되지 않는다', () => {
    const r = ask('S1', 'ASK_LABEL_CHANGE')
    expect(r.mode).toBe('DEFLECT')
    expect(r.factIds.length).toBeGreaterThan(0)
  })

  it('다섯 명 모두 최소 한 화제에서는 정보를 내놓는다 — 전원 벽인 인물이 없다', () => {
    for (const s of SUSPECTS) {
      const intents: QuestionIntent[] = ['ASK_TIMELINE', 'ASK_LOCATION_AT_TIME', 'ASK_RELATIONSHIP']
      const yields = intents.some((i) => {
        const r = ask(s, i)
        return r.claimIds.length > 0 || r.factIds.length > 0
      })
      expect(yields, `${s} 가 아무것도 내놓지 않는다`).toBe(true)
    }
  })
})

describe('명세 §17 — 류나린의 퇴장은 검증 대상이지 자백 대상이 아니다', () => {
  it('처음에는 퇴장 진술을 유지한다 (DEFLECT)', () => {
    const r = ask('S1', 'ASK_DEPARTURE')
    expect(r.mode).toBe('DEFLECT')
    expect(r.claimIds).toEqual(['CLM-GC001-RYU-LEFT'])
  })

  it('문 열림 규격을 쥐고 물으면 말을 고친다 — 그러나 자백은 없다', () => {
    const r = ask('S1', 'ASK_DEPARTURE', { held: ['F-GC001-DOOR-OPEN-NOT-PASSAGE'] })
    expect(r.mode).toBe('REVISE')
    expect(r.claimIds).toEqual(['CLM-GC001-RYU-LEFT-PRESSED'])
    expect(r.revisionOf).toEqual(['CLM-GC001-RYU-LEFT', 'CLM-GC001-RYU-LEFT-PRESSED'])
    // 자백 문구가 아니다
    expect(gc001Claim('CLM-GC001-RYU-LEFT-PRESSED')!.text).not.toContain('제가 했습니다')
  })

  it('플레이어가 직접 추궁해도 열린다 — 근거 없이 추궁만으로도 (명세 §14)', () => {
    const claimStates: Record<string, ClaimState> = { 'CLM-GC001-RYU-LEFT': 'CHALLENGED' }
    expect(ask('S1', 'ASK_DEPARTURE', { claimStates }).mode).toBe('REVISE')
  })

  it('이미 고친 말은 다시 무너지지 않는다 — 심문이 자판기가 되지 않는다', () => {
    const claimStates: Record<string, ClaimState> = {
      'CLM-GC001-RYU-LEFT': 'DISPROVED',
      'CLM-GC001-RYU-LEFT-PRESSED': 'REVISED',
    }
    const r = ask('S1', 'ASK_DEPARTURE', { held: ['F-GC001-DOOR-OPEN-NOT-PASSAGE'], claimStates })
    expect(r.mode).toBe('ANSWER')
    expect(r.revisionOf).toBeUndefined()
  })
})

describe('명세 §18·§19 — 비범인의 비밀', () => {
  it('문소라는 상자 기록을 쥐고 물으면 인정한다', () => {
    const r = ask('S3', 'ASK_CRATE_MOVEMENT', { held: ['E3'] })
    expect(r.mode).toBe('REVISE')
    expect(r.claimIds).toEqual(['CLM-GC001-MUN-MOVED'])
  })

  it('AC-04 — 김하늘의 카메라 진술은 **여러 근거 중 하나**로 열린다', () => {
    const routes = ['E3', 'E8', 'F-GC001-LABEL-CHANGED-2118', 'F-GC001-CRATE-MOVED-2109']
    for (const id of routes) {
      expect(ask('S5', 'ASK_CAMERA_STATUS', { held: [id] }).mode, `근거 ${id}`).toBe('REVISE')
    }
  })

  it('근거가 없으면 카메라 진술을 유지한다', () => {
    expect(ask('S5', 'ASK_CAMERA_STATUS').mode).toBe('DEFLECT')
  })

  it('제시(PRESENT_CLUE)는 화제어가 없어도 답이 나온다', () => {
    const r = ask('S3', 'PRESENT_CLUE', { presentedClueIds: ['E3'] })
    expect(r.mode).toBe('REVISE')
    expect(r.claimIds).toEqual(['CLM-GC001-MUN-MOVED'])
  })

  it('추궁(CHALLENGE_CLAIM)도 그 인물의 열릴 수 있는 화제를 찾는다', () => {
    const claimStates: Record<string, ClaimState> = { 'CLM-GC001-MUN-NO-MOVE': 'CHALLENGED' }
    expect(ask('S3', 'CHALLENGE_CLAIM', { claimStates }).mode).toBe('REVISE')
  })
})

describe('모르는 화제와 못 읽은 질문 (명세 §12)', () => {
  it('규칙이 없는 화제는 UNSURE — 되묻지 않고 모른다고 답한다', () => {
    const r = ask('S4', 'ASK_REVISION_PERMISSION')
    expect(r.mode).toBe('UNSURE')
    expect(r.claimIds).toHaveLength(0)
  })

  it('의도를 못 읽었으면 CLARIFY — 되묻는다', () => {
    expect(ask('S1', 'UNKNOWN').mode).toBe('CLARIFY')
    expect(ask('S1', 'ASK_TIMELINE', { confidence: 0.2 }).mode).toBe('CLARIFY')
  })
})

describe('경계 — AI 는 표현만 한다', () => {
  it('금지 사실 id 는 항상 실리고, 그 내용은 어디에도 없다', () => {
    const r = ask('S1', 'ASK_DEPARTURE')
    expect(r.forbiddenFactIds).toEqual([...FORBIDDEN_FACT_IDS])
    const block = renderAllowedBlock(r, look)
    for (const id of FORBIDDEN_FACT_IDS) expect(block).not.toContain(id)
  })

  it('프롬프트 블록에는 허용된 문장만 실린다', () => {
    const r = ask('S3', 'ASK_LOCATION_AT_TIME')
    const block = renderAllowedBlock(r, look)
    expect(block).toContain(gc001Claim('CLM-GC001-MUN-LOADING')!.text)
    expect(block).toContain(gc001Fact('F-GC001-MAIN-LOADING-TRAVEL-TIME')!.text)
    // 다른 인물의 진술은 절대 실리지 않는다
    expect(block).not.toContain(gc001Claim('CLM-GC001-RYU-LEFT')!.text)
  })

  it('결정론 — 같은 입력은 같은 허용 범위다', () => {
    const once = JSON.stringify(ask('S5', 'ASK_CAMERA_STATUS', { held: ['E8'] }))
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(ask('S5', 'ASK_CAMERA_STATUS', { held: ['E8'] }))).toBe(once)
    }
  })
})

describe('AC-13 — AI 가 죽어도 규칙 기반 폴백으로 사건이 진행된다', () => {
  it('허용된 진술이 있으면 그 문장을 그대로 말한다', () => {
    const r = ask('S3', 'ASK_CRATE_MOVEMENT', { held: ['E3'] })
    expect(ruleFallbackSpeech(r, look)).toBe(gc001Claim('CLM-GC001-MUN-MOVED')!.text)
  })

  it('진술이 없고 사실만 있으면 사실을 말한다', () => {
    const r = ask('S1', 'ASK_CRATE_MOVEMENT')
    expect(ruleFallbackSpeech(r, look)).toBe(gc001Fact('F-GC001-CRATE-MOVED-2109')!.text)
  })

  it('모르는 화제·못 읽은 질문에도 사람이 할 말이 있다', () => {
    expect(ruleFallbackSpeech(ask('S4', 'ASK_REVISION_PERMISSION'), look)).toContain('알 수 없습니다')
    expect(ruleFallbackSpeech(ask('S1', 'UNKNOWN'), look)).toContain('모르겠습니다')
  })
})

describe('규칙 표 정합성 — 없는 것을 가리키지 않는다', () => {
  const claimIds = new Set(GC001_CLAIMS.map((c) => c.id))
  const factIds = new Set(GC001_FACTS.map((f) => f.id))

  it('모든 claim id 가 실재한다', () => {
    for (const r of GC001_KNOWLEDGE) {
      for (const id of [...(r.baseClaimIds ?? []), ...(r.defensiveClaimIds ?? []), ...(r.revisedClaimIds ?? [])]) {
        expect(claimIds.has(id), `${r.suspectId}/${r.intent} → ${id}`).toBe(true)
      }
    }
  })

  it('모든 fact id 가 실재한다', () => {
    for (const r of GC001_KNOWLEDGE) {
      for (const id of r.availableFactIds ?? []) {
        expect(factIds.has(id), `${r.suspectId}/${r.intent} → ${id}`).toBe(true)
      }
    }
  })

  it('requiredContextIds 는 기록(E*)이거나 Fact 다', () => {
    for (const r of GC001_KNOWLEDGE) {
      for (const id of r.requiredContextIds ?? []) {
        expect(/^E\d+$/.test(id) || factIds.has(id), `${r.suspectId}/${r.intent} → ${id}`).toBe(true)
      }
    }
  })

  it('말하는 진술은 반드시 **그 사람의** 진술이다 — 남의 말을 하지 않는다', () => {
    for (const r of GC001_KNOWLEDGE) {
      for (const id of [...(r.baseClaimIds ?? []), ...(r.defensiveClaimIds ?? []), ...(r.revisedClaimIds ?? [])]) {
        expect(gc001Claim(id)!.speaker, `${r.suspectId}/${r.intent} → ${id}`).toBe(r.suspectId)
      }
    }
  })

  it('같은 (인물·의도) 조합은 한 줄뿐이다 — 판단이 두 곳에 나뉘지 않는다', () => {
    const keys = GC001_KNOWLEDGE.map((r) => `${r.suspectId}/${r.intent}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('수정 진술이 있으면 반드시 열 수 있는 문(추궁 대상이나 근거)이 있다', () => {
    for (const r of GC001_KNOWLEDGE) {
      if (!r.revisedClaimIds?.length) continue
      const hasTarget = !!(r.defensiveClaimIds?.length || r.baseClaimIds?.length)
      const hasContext = !!r.requiredContextIds?.length
      expect(hasTarget || hasContext, `${r.suspectId}/${r.intent}`).toBe(true)
    }
  })
})
