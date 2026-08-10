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

/** 카드 데이터 — 규칙은 engine 이 소유하고, 여기서는 읽어서 늘어놓기만 한다. */
export function wallData(c: CaseFile, g: GameState): WallCard[] {
  const cands = candidatesFrom(c, new Set(g.cards))
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
      cleared: !cands.includes(s),
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
  wrap.appendChild(el('div', 'cwall-sub',
    '카드를 누르면 취조실로 데려온다. 붉은 대각선은 기록으로 소거된 사람이다 — 진술이 아니라 기록만이 사람을 지운다.'))

  const board = el('div', 'cwall-board')
  cards.forEach((c, i) => {
    const card = el('div', `pcard${c.cleared ? ' out' : ''}${opts.entering ? ' enter' : ''}`)
    // 살짝 기울어진 채 꽂힌다 — 각도는 자리가 정한다 (Math.random 금지)
    card.style.setProperty('--tilt', `${[-2.2, 1.6, -1.1, 2.4, -1.8][i % 5]}deg`)
    if (opts.entering) card.style.animationDelay = `${i * 120}ms`   // 120ms 스태거 (기획서 §C)
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
