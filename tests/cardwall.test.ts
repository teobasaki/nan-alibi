/**
 * 프로필 카드 월 — 데이터 계층(wallData)을 잠근다 (기획서 ⑥-⑥의 헤드리스 몫).
 * 소거 판정은 engine(candidatesFrom)이 소유하고 카드 월은 읽기만 한다 —
 * 두 값이 어긋나면 격자와 벽이 다른 말을 하는 화면이 된다.
 */
import { describe, it, expect } from 'vitest'
import { wallData } from '../src/ui/cardwall'
import { generateValidCase } from '../src/engine/validate'
import { availableEvidence, createGame, interview, lookupEvidence } from '../src/engine/game'
import { candidatesFrom } from '../src/engine/solver'
import { gc001Case } from '../src/data/gc001'
import { SUSPECTS } from '../src/types'
import { TALK_CAP } from '../src/data/config'

const CASE = generateValidCase(36).case

describe('카드 월 데이터 — 규칙은 engine 이 소유한다', () => {
  it('카드는 언제나 5장, 순서는 용의자 순서다', () => {
    const cards = wallData(CASE, createGame(CASE))
    expect(cards.map((c) => c.id)).toEqual([...SUSPECTS])
    for (const c of cards) {
      expect(c.name).toBe(CASE.suspects[c.id].name)
      expect(c.age).toBe(CASE.suspects[c.id].age)
      expect(c.job).toBe(CASE.suspects[c.id].job)
    }
  })

  it('시작 시점 — 아무도 소거되지 않았고 대화는 0/10 이다', () => {
    const cards = wallData(CASE, createGame(CASE))
    expect(cards.every((c) => !c.cleared)).toBe(true)
    expect(cards.every((c) => c.talks === 0 && c.cap === TALK_CAP)).toBe(true)
  })

  it('소거 표시는 candidatesFrom 의 여집합과 정확히 일치한다', () => {
    // 범행 시각 기록을 모두 조회해 소거를 만든다
    let g = createGame(CASE)
    for (const e of availableEvidence(g)) {
      if (g.investigationsLeft <= 0) break
      g = lookupEvidence(g, e.id)
    }
    const cands = candidatesFrom(CASE, new Set(g.cards))
    const cards = wallData(CASE, g)
    for (const c of cards) expect(c.cleared).toBe(!cands.includes(c.id))
    // 시드 36 은 기록으로 최소 한 명은 지워진다 — 소거가 실제로 일어났는지도 본다
    expect(cards.some((c) => c.cleared)).toBe(true)
  })

  it('심문하면 대화 수와 진술 궤적이 카드에 반영된다', () => {
    const s = SUSPECTS[0]!
    const g = interview(createGame(CASE), s)
    const card = wallData(CASE, g).find((c) => c.id === s)!
    expect(card.talks).toBe(1)
    expect(card.traj).not.toBe('')          // 궤적 5칸이 열렸다
    const other = wallData(CASE, g).find((c) => c.id === SUSPECTS[1]!)!
    expect(other.talks).toBe(0)
  })

  it('gc001 도 같은 문법 — 라벨은 사건이 소유한다 (⑥-⑧)', () => {
    const c = gc001Case()
    const cards = wallData(c, createGame(c))
    expect(cards).toHaveLength(5)
    expect(cards.map((x) => x.name)).toEqual(SUSPECTS.map((s) => c.suspects[s].name))
    // 심문하면 궤적 라벨이 갤러리 어휘로 나온다 (호텔 상수가 아니라 월드 헬퍼)
    const g = interview(createGame(c), 'S1')
    const traj = wallData(c, g).find((x) => x.id === 'S1')!.traj
    expect(traj).not.toBe('')
    if (c.world) expect(traj).toContain(c.world.slotLabels[0])
  })
})
