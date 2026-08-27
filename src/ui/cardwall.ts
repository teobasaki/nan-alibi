/**
 * 프로필 카드 월 — **수집이 끝난 뒤의 심문 허브** (기획서 §C).
 *
 * 코르크 보드에 다섯 장이 핀으로 꽂힌다. 앞면은 사람(초상·이름·나이·직업·남은 대화),
 * 뒷면은 수사(관계·읽힌 성향·확보한 진술). 기록으로 소거된 자는 붉은 대각선과 인장 —
 * "기록만이 사람을 지운다" 는 규칙이 이 벽에서도 같은 문법으로 보인다.
 *
 * ## 경계 (이 프로젝트의 상수)
 * - `wallData` 는 **순수 함수**다: 상태를 읽어 카드 데이터를 만들 뿐, 소거 판정은
 *   `candidatesFrom`(engine)이 소유한다. 3D 없는 계층이라 헤드리스 테스트가 잠근다.
 * - 초상이 없으면 이니셜 실루엣으로 선다 — 에셋 0장 원칙 (portraits.ts 와 같은 폴백).
 */

import { candidatesFrom } from '../engine/solver'
import { claimCardId, type GameState } from '../engine/game'
import { TALK_CAP } from '../data/config'
import {
  placeLabel, slotLabel, SLOTS, SUSPECTS, type CaseFile, type SuspectId,
} from '../types'

export interface WallCard {
  id: SuspectId
  name: string
  age: number
  job: string
  relation: string
  /** 소모한 대화 수 — 앞면의 n/10 */
  talks: number
  cap: number
  /** 기록으로 소거됐는가 — 붉은 대각선 + 인장 */
  cleared: boolean
  /** 이 사람에게서 찾아낸 모순 수 */
  stamps: number
  /** 확보한 진술 궤적 한 줄 (없으면 빈 문자열) */
  traj: string
}

/**
 * MIG-003: 카드 월 데이터 생성 옵션.
 * 정본 지시: Core Loop Migration 「시스템의 자동 후보 제외 제거」
 *          · 재편성안 3.1.1 「증거 자동 해석·용의자 자동 제외 문제」
 */
export interface WallDataOpts {
  /**
   * 시스템 자동 소거를 화면에 드러낼 것인가.
   * - `true`(기본값): 기존 동작 — candidatesFrom 결과로 카드 .out + 인장
   * - `false`: GC-001 정책 — 소거 판정은 엔진이 그대로 하되 카드에 드러내지 않는다
   */
  showClearing?: boolean
}

/** 카드 데이터 — 규칙은 engine 이 소유하고, 여기서는 읽어서 늘어놓기만 한다. */
export function wallData(c: CaseFile, g: GameState, opts?: WallDataOpts): WallCard[] {
  const cands = candidatesFrom(c, new Set(g.cards))
  // MIG-003: showClearing 이 false 면 소거를 화면에 드러내지 않는다 (기본값 true — 기존 동작)
  const showClearing = opts?.showClearing ?? true
  return SUSPECTS.map((s) => {
    const sus = c.suspects[s]
    const traj = SLOTS
      .filter((t) => g.cards.includes(claimCardId(s, t)))
      .map((t) => `${slotLabel(c, t)} ${placeLabel(c, sus.claim[t]!)}`)
      .join(' › ')
    return {
      id: s,
      name: sus.name,
      age: sus.age,
      job: sus.job,
      relation: sus.relation,
      talks: g.talks[s],
      cap: TALK_CAP,
      cleared: showClearing ? !cands.includes(s) : false,
      stamps: g.foundContradictions.filter((k) => k.split('|')[1] === s).length,
      traj,
    }
  })
}

export interface WallOpts {
  /** 초상 URL — 없으면 이니셜 실루엣. 배역은 **슬롯**이 정한다 (main 이 배역표로 계산) */
  portrait(id: SuspectId): string | null
  /** 읽힌 성향 한 줄 — persona 표는 main 이 안다 */
  personaLine(s: SuspectId): string
  /** 인장 연출을 이미 찍은 카드 — 재렌더마다 쾅쾅대지 않기 위해 (ui.stamped 와 같은 이유) */
  stampedSeen: Set<string>
  /** 카드가 처음 꽂히는 스태거 연출을 돌릴 것인가 — 첫 진입에만 */
  entering: boolean
  /**
   * 자동 소거를 화면에 드러내는가 (MIG-003). 기본은 기존 동작(`true`).
   * `false` 면 소거를 설명하는 안내 문장도 함께 사라진다 — 끝까지 나타나지 않는
   * 표식을 찾게 만들면 안내가 아니라 함정이다.
   */
  showClearing?: boolean
  onPick(s: SuspectId): void
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/**
 * 코르크 보드 DOM. 뒤집기는 hover(데스크탑)와 클릭 토글(그 외) 둘 다 —
 * 카드 본체 클릭은 심문 진입이고, 뒤집기는 모서리의 [뒤] 단추가 맡는다.
 * 한 카드에 두 행동을 겹치면 뒤집으려다 취조실로 끌려간다.
 */
export function renderWall(cards: WallCard[], opts: WallOpts): HTMLElement {
  const wrap = el('div', 'cwall')
  wrap.appendChild(el('div', 'cwall-cap', '용의자 다섯 — 한 명이 범인이다'))
  /**
   * 안내 한 줄. **소거를 설명하는 문장은 소거가 보일 때만 있다** (MIG-003) —
   * GC-001 처럼 표시를 끈 사건에서 이 문장이 남으면, 끝까지 나타나지 않는 표식을
   * 찾게 만든다. 카드 하나라도 소거로 그려졌는지를 보고 정한다.
   */
  const showClearing = opts.showClearing ?? true
  wrap.appendChild(el('div', 'cwall-sub', showClearing
    ? '카드를 누르면 취조실로 데려온다. 붉은 대각선은 기록으로 소거된 사람이다 — 진술이 아니라 기록만이 사람을 지운다.'
    : '카드를 누르면 취조실로 데려온다. 누구를 지울지는 당신이 정한다 — 시스템은 사람을 지우지 않는다.'))

  const board = el('div', 'cwall-board')
  cards.forEach((c, i) => {
    const card = el('div', `pcard${c.cleared ? ' out' : ''}${opts.entering ? ' enter' : ''}`)
    // 살짝 기울어진 채 꽂힌다 — 각도는 자리가 정한다 (Math.random 금지)
    card.style.setProperty('--tilt', `${[-2.2, 1.6, -1.1, 2.4, -1.8][i % 5]}deg`)
    /**
     * **한 벌이 손에서 쫙 펼쳐진다** (R3 · 연극 3막). 다섯 장이 각자 위에서
     * 떨어지면 그건 다섯 번의 사건이지만, **가운데 한 덩이에서 좌우로 퍼지면**
     * 형사가 카드 한 벌을 책상에 펼치는 한 번의 동작이 된다.
     * 시작 위치는 자리가 정한다 — 가운데(mid)로부터의 거리만큼 안쪽에서 출발한다.
     */
    const mid = (cards.length - 1) / 2
    card.style.setProperty('--dx', `${(mid - i) * 76}px`)
    card.style.setProperty('--fan', `${(i - mid) * -13}deg`)
    if (opts.entering) card.style.animationDelay = `${i * 90}ms`    // 스태거 (기획서 §C)
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.setAttribute('aria-label', `${c.name} 심문하기${c.cleared ? ' (기록으로 소거됨)' : ''}`)
    card.dataset.fk = `wall:${c.id}`

    const inner = el('div', 'pcard-in')

    /* 앞면 */
    const front = el('div', 'pcard-face pcard-front')
    front.appendChild(el('i', 'pcard-pin'))
    const shot = opts.portrait(c.id)
    const face = el('div', `pcard-photo${shot ? '' : ' plate'}`, shot ? '' : c.name[0]!)
    if (shot) face.style.backgroundImage = `url(${shot})`
    front.appendChild(face)
    front.appendChild(el('div', 'pcard-name', c.name))
    front.appendChild(el('div', 'pcard-job', `${c.age}세 · ${c.job}`))
    front.appendChild(el('div', `pcard-talk${c.talks >= c.cap ? ' off' : ''}`, `대화 ${c.talks} / ${c.cap}`))
    if (c.stamps > 0) front.appendChild(el('div', 'pcard-stamps', `모순 ${c.stamps}건`))
    inner.appendChild(front)

    /* 뒷면 */
    const back = el('div', 'pcard-face pcard-back')
    back.appendChild(el('div', 'pcard-bk', '관계'))
    back.appendChild(el('div', 'pcard-bv', c.relation))
    back.appendChild(el('div', 'pcard-bk', '읽힌 성향'))
    back.appendChild(el('div', 'pcard-bv', opts.personaLine(c.id)))
    back.appendChild(el('div', 'pcard-bk', '확보한 진술'))
    back.appendChild(el('div', 'pcard-bv', c.traj || '아직 받아낸 진술이 없다'))
    inner.appendChild(back)

    card.appendChild(inner)

    if (c.cleared) {
      const stamp = el('div', 'pcard-out', '기록으로\n소거')
      // 처음 소거되는 그 순간에만 쾅 — 재렌더마다 다시 찍히면 인장이 소음이 된다
      if (!opts.stampedSeen.has(c.id)) {
        opts.stampedSeen.add(c.id)
        stamp.classList.add('fresh')
      }
      card.appendChild(stamp)
    }

    const flip = el('button', 'pcard-flip', '뒤') as HTMLButtonElement
    flip.setAttribute('aria-label', `${c.name} 카드 뒤집기`)
    flip.onclick = (e) => { e.stopPropagation(); card.classList.toggle('flip') }
    card.appendChild(flip)

    const choose = (): void => opts.onPick(c.id)
    card.onclick = choose
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }
    board.appendChild(card)
  })
  wrap.appendChild(board)
  return wrap
}
