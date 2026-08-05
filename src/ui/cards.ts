/**
 * 카드 렌더러 (Task 12) — 증거의 핵심 정보는 **데이터에서 DOM 으로 직접** 그린다.
 *
 * 이미지 생성 모델에 글자를 맡기지 않는 이유 (기획서 §11):
 *   생성 이미지 속 시각·이름이 사건 데이터와 어긋나는 순간 추리가 붕괴한다.
 *   플레이어는 그걸 "AI 오류" 가 아니라 "단서" 로 읽고 한 판을 통째로 날린다.
 */

import {
  PLACE_LABEL,
  SLOT_LABEL,
  type CaseFile,
  type Evidence,
  type Slot,
  type SuspectId,
} from '../types'
import { parseClaimCard } from '../engine/game'

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

const KIND_LABEL: Record<Evidence['kind'], string> = {
  keycard: '카드키 출입 기록',
  cctv: 'CCTV 로그',
  call: '통화 기지국 기록',
  receipt: '영수증',
}

function defList(rows: [string, string][]): HTMLElement {
  const dl = el('dl')
  for (const [k, v] of rows) {
    dl.appendChild(el('dt', undefined, k))
    dl.appendChild(el('dd', undefined, v))
  }
  return dl
}

function nameOf(c: CaseFile, s: SuspectId): string {
  return c.suspects[s].name
}

/** 물증 카드 — 종류마다 다른 서식으로 그려 "기록물" 느낌을 준다 */
export function renderEvidenceCard(c: CaseFile, e: Evidence): HTMLElement {
  const card = el('div', 'evcard')
  card.dataset.cardId = e.id

  const head = el('div', 'head')
  head.appendChild(el('span', undefined, KIND_LABEL[e.kind]))
  head.appendChild(el('span', undefined, e.id))
  card.appendChild(head)

  const who = e.subjects.map((s) => nameOf(c, s)).join(', ')
  const rows: [string, string][] =
    e.kind === 'cctv'
      ? [['구역', PLACE_LABEL[e.place]], ['시각', SLOT_LABEL[e.slot]], ['식별', who]]
      : e.kind === 'keycard'
        ? [['소지자', who], ['지점', PLACE_LABEL[e.place]], ['시각', SLOT_LABEL[e.slot]], ['결과', '승인'],
           ...(e.keyLabel ? [['발급 구분', e.keyLabel] as [string, string]] : [])]
        : e.kind === 'call'
          ? [['가입자', who], ['기지국', PLACE_LABEL[e.place]], ['시각', SLOT_LABEL[e.slot]]]
          : [['결제자', who], ['매장', PLACE_LABEL[e.place]], ['시각', SLOT_LABEL[e.slot]]]

  card.appendChild(defList(rows))
  return card
}

/** 진술 카드 — 물증과 시각적으로 확실히 구분한다 (한쪽은 종이, 한쪽은 말) */
export function renderClaimCard(c: CaseFile, s: SuspectId, slot: Slot): HTMLElement {
  const card = el('div', 'evcard claim')
  card.dataset.cardId = `C:${s}:${slot}`

  const head = el('div', 'head')
  head.appendChild(el('span', undefined, `${nameOf(c, s)}의 진술`))
  head.appendChild(el('span', undefined, SLOT_LABEL[slot]))
  card.appendChild(head)

  card.appendChild(
    el('div', undefined, `"${SLOT_LABEL[slot]}에는 ${PLACE_LABEL[c.suspects[s].claim[slot]!]}에 있었습니다."`),
  )
  return card
}

/** 증언 카드 — 심문으로 얻은 것 */
export function renderTestimonyCard(c: CaseFile, id: string): HTMLElement {
  const t = c.testimonies.find((x) => x.id === id)
  const card = el('div', 'evcard claim')
  card.dataset.cardId = id
  const head = el('div', 'head')
  head.appendChild(el('span', undefined, t ? `${nameOf(c, t.from)}의 증언` : '증언'))
  head.appendChild(el('span', undefined, id))
  card.appendChild(head)
  card.appendChild(el('div', undefined, t?.text ?? id))
  return card
}

/** 보유 카드 id 하나를 알맞은 렌더러로 보낸다 */
export function renderCard(c: CaseFile, id: string): HTMLElement {
  const ev = c.evidence.find((e) => e.id === id)
  if (ev) return renderEvidenceCard(c, ev)
  const claim = parseClaimCard(id)
  if (claim) return renderClaimCard(c, claim.suspect, claim.slot)
  return renderTestimonyCard(c, id)
}

/** 카드의 사람이 읽는 한 줄 — 증거 제시 시 프롬프트에 넣는 설명 */
export function cardSummary(c: CaseFile, id: string): string {
  const ev = c.evidence.find((e) => e.id === id)
  if (ev) {
    const who = ev.subjects.map((s) => nameOf(c, s)).join(', ')
    return `${KIND_LABEL[ev.kind]}: ${SLOT_LABEL[ev.slot]} ${PLACE_LABEL[ev.place]}, ${who}`
  }
  const claim = parseClaimCard(id)
  if (claim) {
    return `${nameOf(c, claim.suspect)}의 진술: ${SLOT_LABEL[claim.slot]} ${PLACE_LABEL[c.suspects[claim.suspect].claim[claim.slot]!]}`
  }
  return c.testimonies.find((t) => t.id === id)?.text ?? id
}
