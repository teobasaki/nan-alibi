/**
 * 「30초의 현장」 규칙 계층 — 기획서 ⑥의 헤드리스 몫을 잠근다.
 *   ① 훑기 5.0초 후 30.0초 카운트다운 (상태 전이 시각)
 *   ③ 가방 5/5 스왑 — 교체 시 이전 기록이 cards 에서 제거된다
 *   ④ 시간 종료 = 예산 0 (기존 게이트가 그대로 연다)
 *   ⑦ calm 모드 — 타이머 없음
 * 3D 그림은 여기 없다 — 시각 판정·배치처럼 틀리면 자원을 잃는 것만 순수 함수로 떼었다.
 */
import { describe, it, expect } from 'vitest'
import {
  SCENE_FX, phaseAt, remainMs, pulseAt, vignetteAt, timeUp, swapField, bagIds,
  sceneBlocked, spawnFor, spawnAnchored, moveSpeedFor, rampTo,
  DEATH_AT, SCENE_START, SCENE_PLACE_AT,
} from '../src/ui/sceneRules'
import { generateValidCase } from '../src/engine/validate'
import { availableEvidence, createGame, fieldDone, lookupEvidence } from '../src/engine/game'
import { gc001Case } from '../src/data/gc001'
import type { PlaceId } from '../src/types'

const CASE = generateValidCase(36).case

describe('국면 전이 — 훑기 5.0s → 수집 30.0s → 종료 (기획서 ⑥-①)', () => {
  it('0ms 는 훑기다', () => expect(phaseAt(0, false)).toBe('survey'))
  it('4999ms 까지 훑기다', () => expect(phaseAt(4999, false)).toBe('survey'))
  it('정확히 5000ms 에 수집이 시작된다', () => expect(phaseAt(5000, false)).toBe('collect'))
  it('34999ms 까지 수집이다', () => expect(phaseAt(34999, false)).toBe('collect'))
  it('정확히 35000ms(5s+30.0s)에 끝난다', () => expect(phaseAt(35000, false)).toBe('done'))

  it('calm 은 시계가 없다 — 언제나 수집이다 (⑥-⑦)', () => {
    expect(phaseAt(0, true)).toBe('collect')
    expect(phaseAt(35000, true)).toBe('collect')
    expect(phaseAt(9_999_999, true)).toBe('collect')
  })

  it('잔여 시간은 훑기 중 만땅, 수집 중 감소, 종료 후 0', () => {
    expect(remainMs(0)).toBe(SCENE_FX.collectMs)
    expect(remainMs(5000)).toBe(30000)
    expect(remainMs(20000)).toBe(15000)
    expect(remainMs(35000)).toBe(0)
    expect(remainMs(99999)).toBe(0)
  })
})

describe('압박 곡선 — 30~11s 1Hz · 10~6s 2Hz · 5~0s 심박 (기획서 §3)', () => {
  it('경계값이 기획서 표와 일치한다', () => {
    expect(pulseAt(30)).toBe('tick1')
    expect(pulseAt(11)).toBe('tick1')
    expect(pulseAt(10)).toBe('tick2')
    expect(pulseAt(6)).toBe('tick2')
    expect(pulseAt(5)).toBe('heart')
    expect(pulseAt(0)).toBe('heart')
  })

  it('비네트는 10초부터 조이고 0초에 최대다', () => {
    expect(vignetteAt(30)).toBe(0)
    expect(vignetteAt(10.1)).toBe(0)
    expect(vignetteAt(7)).toBeGreaterThan(0)
    expect(vignetteAt(7)).toBeLessThan(0.45)
    expect(vignetteAt(0)).toBe(1)
  })
})

describe('시간 종료 = 예산 소진과 동일 상태 (기획서 ⑥-④⑤)', () => {
  it('예산이 남았어도 0 이 되고, 기존 게이트(fieldDone)가 열린다', () => {
    const g = createGame(CASE)
    expect(fieldDone(g)).toBe(false)
    const done = timeUp(g)
    expect(done.investigationsLeft).toBe(0)
    expect(fieldDone(done)).toBe(true)
  })

  it('수집 0건이어도 게이트가 열린다 — 흐름이 막히지 않는다 (⑥-⑤)', () => {
    const done = timeUp(createGame(CASE))
    expect(bagIds(done)).toHaveLength(0)
    expect(fieldDone(done)).toBe(true)
  })

  it('이미 0 이면 상태를 새로 만들지 않는다', () => {
    const g = { ...createGame(CASE), investigationsLeft: 0 }
    expect(timeUp(g)).toBe(g)
  })
})

describe('가방 스왑 — 수거는 끝까지 엔진의 조회다 (기획서 ⑥-②③)', () => {
  /** 즉시 조회 가능한 것으로 가방을 가득 채운다 */
  const fillBag = () => {
    let g = createGame(CASE)
    while (g.investigationsLeft > 0) {
      const next = availableEvidence(g).find((e) => e.requires.length === 0)
      if (!next) break
      g = lookupEvidence(g, next.id)
    }
    return g
  }

  it('수거 = 기록 조회와 동일 효과 — cards 에 들어가고 예산이 준다 (⑥-②)', () => {
    const g = createGame(CASE)
    const ev = availableEvidence(g)[0]!
    const after = lookupEvidence(g, ev.id)
    expect(after.cards).toContain(ev.id)
    expect(after.investigationsLeft).toBe(g.investigationsLeft - 1)
  })

  it('교체하면 이전 기록이 cards 에서 빠지고 새 기록이 들어간다 (⑥-③)', () => {
    const g = fillBag()
    expect(g.investigationsLeft).toBe(0)
    const drop = bagIds(g)[0]!
    const pick = availableEvidence(g).find((e) => e.requires.length === 0)
    if (!pick) return // 이 시드에 남은 즉시 조회 기록이 없으면 스왑 자체가 안 뜬다
    const after = swapField(g, drop, pick.id)
    expect(after.cards).not.toContain(drop)
    expect(after.cards).toContain(pick.id)
    // 순비용 0 — 가방 크기는 그대로다
    expect(after.investigationsLeft).toBe(g.investigationsLeft)
    expect(bagIds(after)).toHaveLength(bagIds(g).length)
  })

  it('들고 있지 않은 것은 내려놓을 수 없다', () => {
    const g = fillBag()
    expect(() => swapField(g, '없는것', 'E1')).toThrow()
  })

  it('진술 카드는 가방이 아니다 — bagIds 는 물증만 센다', () => {
    const g = createGame(CASE)
    expect(g.cards.length).toBeGreaterThan(0)   // 무료 공개 진술 카드 5장
    expect(bagIds(g)).toHaveLength(0)
  })
})

describe('현장 배치 — 못 닿는 기록은 없는 기록이다', () => {
  it('시작점·장소 앵커는 전부 설 수 있는 자리다', () => {
    expect(sceneBlocked(SCENE_START[0], SCENE_START[1])).toBe(false)
    for (const [x, z] of SCENE_PLACE_AT) expect(sceneBlocked(x, z)).toBe(false)
  })

  it('시드·gc001 전부 같은 현장 문법 — 모든 스폰이 닿는 자리다 (⑥-⑧)', () => {
    for (const c of [CASE, generateValidCase(7).case, gc001Case()]) {
      const spots = spawnFor(c.evidence.map((e) => ({ id: e.id, place: e.place })))
      expect(spots.size).toBe(c.evidence.length)
      for (const [, [x, z]] of spots) expect(sceneBlocked(x, z)).toBe(false)
    }
  })

  it('같은 입력은 같은 현장이다 — Math.random 이 없다', () => {
    const list = CASE.evidence.map((e) => ({ id: e.id, place: e.place }))
    expect(spawnFor(list)).toEqual(spawnFor(list))
  })

  it('한 장소에 몰려도 서로 겹치지 않는다', () => {
    const list = Array.from({ length: 6 }, (_, i) => ({ id: `X${i}`, place: 2 as PlaceId }))
    const spots = [...spawnFor(list).values()]
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i]![0] - spots[j]![0], spots[i]![1] - spots[j]![1])
        expect(d).toBeGreaterThan(0.6)
      }
    }
  })
})

describe('개연성 배치 — kind 서사 앵커 (개편 라운드, 사용자 결정 3)', () => {
  type EvKind = 'keycard' | 'cctv' | 'call' | 'receipt' | 'autopsy'
  const mk = (kinds: EvKind[]) => kinds.map((k, i) => ({ id: `E${i}`, kind: k }))

  it('cctv 는 벽 상단 부착이다 — 1인칭 시야에서 올려다보이는 2.2~2.6m', () => {
    for (const [, sp] of spawnAnchored(mk(['cctv', 'cctv', 'cctv']))) {
      expect(sp.mounted).toBe(true)
      expect(sp.y!).toBeGreaterThanOrEqual(2.2)
      expect(sp.y!).toBeLessThanOrEqual(2.6)
    }
  })

  it('같은 kind 복수는 서로 다른 앵커로 흩어진다', () => {
    for (const kinds of [['cctv', 'cctv', 'cctv'], ['receipt', 'receipt', 'receipt'], ['call', 'call']] as EvKind[][]) {
      const spots = [...spawnAnchored(mk(kinds)).values()]
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const d = Math.hypot(spots[i]!.at[0] - spots[j]!.at[0], spots[i]!.at[1] - spots[j]!.at[1])
          expect(d).toBeGreaterThan(0.8)
        }
      }
    }
  })

  it('바닥 스폰은 전부 설 수 있는 자리다 — 못 닿는 기록은 없는 기록이다', () => {
    for (const c of [CASE, generateValidCase(7).case, gc001Case()]) {
      const spots = spawnAnchored(c.evidence.map((e) => ({ id: e.id, kind: e.kind })))
      expect(spots.size).toBe(c.evidence.length)
      for (const [, sp] of spots) {
        if (!sp.mounted) expect(sceneBlocked(sp.at[0], sp.at[1])).toBe(false)
      }
    }
  })

  it('autopsy 는 사망 지점(조각상 아래) 곁이다', () => {
    const sp = spawnAnchored(mk(['autopsy'])).get('E0')!
    expect(Math.hypot(sp.at[0] - DEATH_AT[0], sp.at[1] - DEATH_AT[1])).toBeLessThan(2.5)
  })

  it('같은 입력은 같은 배치다 — Math.random 이 없다', () => {
    const list = CASE.evidence.map((e) => ({ id: e.id, kind: e.kind }))
    expect(spawnAnchored(list)).toEqual(spawnAnchored(list))
  })

  it('앵커가 소진돼도 겹치지 않고 선다', () => {
    const spots = [...spawnAnchored(mk(Array(6).fill('receipt') as EvKind[])).values()]
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i]!.at[0] - spots[j]!.at[0], spots[i]!.at[1] - spots[j]!.at[1])
        expect(d).toBeGreaterThan(0.6)
      }
    }
  })
})

describe('이동 체감 — 시점별 상한과 가감속 램프 (실플레이 "너무 빠르다")', () => {
  it('1인칭은 2.4 로 눌리고 조감은 클립 속도 그대로다', () => {
    expect(moveSpeedFor(SCENE_FX.runSpeed, true)).toBe(SCENE_FX.fpSpeed)
    expect(moveSpeedFor(SCENE_FX.runSpeed, false)).toBe(SCENE_FX.runSpeed)
  })

  it('클립보다 빠르게는 만들지 않는다 — 걷기(2.2)는 1인칭에서도 2.2 다', () => {
    expect(moveSpeedFor(SCENE_FX.speed, true)).toBe(SCENE_FX.speed)
  })

  it('램프는 시간상수만큼에 63%에 닿고, 넘어서지 않는다', () => {
    const v = rampTo(0, 3.4, SCENE_FX.rampTau)
    expect(v).toBeGreaterThan(3.4 * 0.6)
    expect(v).toBeLessThan(3.4 * 0.66)
  })

  it('dt 가 커도 목표를 넘지 않는다 — 프레임 급락에도 과속이 없다', () => {
    expect(rampTo(0, 3.4, 5)).toBeLessThanOrEqual(3.4)
    expect(rampTo(3.4, 0, 5)).toBeGreaterThanOrEqual(0)
  })

  it('정지는 진짜 0 이 된다 — 꼬리가 남으면 대기 클립이 안 올라온다', () => {
    const step = (v0: number, sec: number): number => {
      let v = v0
      for (let i = 0; i < Math.round(sec / 0.016); i++) v = rampTo(v, 0, 0.016)
      return v
    }
    // 0.3초(시간상수 2배)면 시작 속도의 15% 아래 — 발이 실질적으로 멎는다
    expect(step(2.4, 0.3)).toBeLessThan(2.4 * 0.15)
    // 그리고 1.5초 안에 정확히 0 이 된다 (스냅 임계 1e-3)
    expect(step(2.4, 1.5)).toBe(0)
  })

  it('dt 0 은 값을 바꾸지 않는다 (탭 정지 프레임)', () => {
    expect(rampTo(1.7, 3.4, 0)).toBe(1.7)
  })
})

describe('마커 구성 — 한 증거는 한 자리다 (중복 스폰 회귀 잠금)', () => {
  it('증거 하나당 좌표 하나 — id 가 겹치지 않는다', () => {
    for (const c of [CASE, generateValidCase(7).case, gc001Case()]) {
      const list = c.evidence.map((e) => ({ id: e.id, kind: e.kind }))
      const spots = spawnAnchored(list)
      expect(spots.size).toBe(list.length)
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length)
    }
  })

  it('두 번 불러도 자리가 늘지 않는다 — 재진입이 배치를 쌓지 않는다', () => {
    const list = CASE.evidence.map((e) => ({ id: e.id, kind: e.kind }))
    const a = spawnAnchored(list)
    const b = spawnAnchored(list)
    expect(b.size).toBe(a.size)
    for (const [id, sp] of a) expect(b.get(id)).toEqual(sp)
  })
})
