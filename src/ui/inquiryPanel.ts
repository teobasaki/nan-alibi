/**
 * 수사일지의 조사 면 — **들은 말, 바뀐 말, 확정된 사실** (명세 V0.2 §36).
 *
 * 명세가 이 면에 요구하는 것: Claim 확인 · 변경된 Claim 확인 · Fact 확인 · Evidence 확인 ·
 * 현재 의심 인물 표시 · 플레이어 메모. 그리고 한 줄이 더 있다 —
 *
 * > 시스템이 자동으로 "류나린이 거짓말했다" 또는 "문소라는 범인이 아니다" 라고 결론내지 않는다.
 * > 판단은 플레이어에게 맡긴다.
 *
 * 그래서 이 부품은 **상태를 이름으로만 적는다.** `DISPROVED` 를 "거짓말" 이라 쓰지 않고
 * "기록과 어긋난다" 로 쓴다 — 어긋남은 관찰이고, 거짓말은 판단이다 (AC-12).
 *
 * ## 경계
 * - 판정하지 않는다. 상태는 `engine/inquiry.ts` 가 이미 정한 값을 읽기만 한다.
 * - 전역 `ui` 를 모른다. 필요한 것은 전부 인자로 받는다 (`chalkboard.ts` 와 같은 규율).
 * - 자기 CSS 를 자기가 import 한다 (이 저장소가 두 번 밟은 함정).
 */

import '../styles/inquiry.css'
import type { ClaimState, EvidenceState, InquiryState } from '../engine/inquiry'
import type { SuspectId } from '../types'

/* ────────────────────────────── 뷰 모델 ────────────────────────────── */

export interface InquiryClaimRow {
  id: string
  speaker: SuspectId
  speakerName: string
  text: string
  at?: string
  state: ClaimState
  /** 이 진술을 대체한 진술 (있으면 아래에 붙여 함께 보여준다 — 명세 §15) */
  revisedById?: string
}

export interface InquiryFactRow {
  id: string
  text: string
  source: string
}

export interface InquiryEvidenceRow {
  id: string
  label: string
  state: EvidenceState
}

export interface InquiryView {
  claims: InquiryClaimRow[]
  facts: InquiryFactRow[]
  evidence: InquiryEvidenceRow[]
  /** 다음 질문거리 — 흔들리거나 추궁 중인 진술 id */
  shaky: string[]
  suspect: SuspectId | null
  people: { id: SuspectId; name: string }[]
  memo: string
}

export interface InquiryHandlers {
  /** 지금 의심하는 사람을 바꾼다. **정답 제출이 아니다** (명세 §22) */
  pickSuspect(id: SuspectId | null): void
  setMemo(text: string): void
}

/** 상태의 이름 — **관찰만 적는다.** 판단하는 낱말("거짓말")은 쓰지 않는다 */
export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  KNOWN: '들었다',
  QUESTIONABLE: '확인이 필요하다',
  CHALLENGED: '추궁했다',
  REVISED: '고쳐 말했다',
  CONFIRMED: '기록과 맞는다',
  DISPROVED: '기록과 어긋난다',
}

const EV_STATE_LABEL: Record<EvidenceState, string> = {
  AVAILABLE: '아직 못 봤다',
  DISCOVERED: '확보',
  UNDERSTOOD: '의미 확인',
}

/* ────────────────────────────── 상태 → 뷰 ────────────────────────────── */

export interface InquirySource {
  claim(id: string): { speaker: SuspectId; text: string; at?: string; revisedTo?: string } | undefined
  fact(id: string): { text: string; source: string } | undefined
  suspectName(id: SuspectId): string
  evidenceLabel(id: string): string
  people: { id: SuspectId; name: string }[]
}

/**
 * 순수 변환. **정렬은 사람 → 시각** 이다 — 한 사람의 말이 흩어져 있으면 변화를 못 읽는다.
 * 수정 진술(`revises`)은 원본 바로 아래에 붙는다.
 */
export function inquiryView(s: InquiryState, src: InquirySource, shaky: string[]): InquiryView {
  const rows: InquiryClaimRow[] = []
  for (const [id, track] of Object.entries(s.claims)) {
    const def = src.claim(id)
    if (!def) continue
    rows.push({
      id,
      speaker: def.speaker,
      speakerName: src.suspectName(def.speaker),
      text: def.text,
      ...(def.at ? { at: def.at } : {}),
      state: track.state,
      ...(def.revisedTo && s.claims[def.revisedTo] ? { revisedById: def.revisedTo } : {}),
    })
  }
  // 사람 순서는 사건이 준 순서(people)를 따른다. 같은 사람 안에서는 시각 순.
  const order = new Map(src.people.map((p, i) => [p.id, i]))
  rows.sort((a, b) =>
    (order.get(a.speaker) ?? 9) - (order.get(b.speaker) ?? 9)
    || (a.at ?? '').localeCompare(b.at ?? ''))

  return {
    claims: rows,
    facts: s.facts.map((id) => {
      const f = src.fact(id)
      return f ? { id, text: f.text, source: f.source } : null
    }).filter((x): x is InquiryFactRow => x !== null),
    evidence: Object.entries(s.evidence)
      .filter(([, st]) => st !== 'AVAILABLE')
      .map(([id, st]) => ({ id, label: src.evidenceLabel(id), state: st })),
    shaky,
    suspect: s.suspect,
    people: src.people,
    memo: s.memo,
  }
}

/* ────────────────────────────── 그리기 ────────────────────────────── */

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function claimRow(r: InquiryClaimRow, isRevision: boolean): HTMLElement {
  const box = el('div', `iq-claim s-${r.state.toLowerCase()}${isRevision ? ' rev' : ''}`)
  const head = el('div', 'iq-claim-h')
  head.appendChild(el('span', 'iq-who', isRevision ? '고친 말' : r.speakerName))
  if (r.at) head.appendChild(el('span', 'iq-at', r.at))
  head.appendChild(el('span', 'iq-state', CLAIM_STATE_LABEL[r.state]))
  box.appendChild(head)
  box.appendChild(el('div', 'iq-quote', `“${r.text}”`))
  return box
}

/**
 * 조사 면을 그린다. 상태를 읽어 그리기만 하며, 어떤 판정도 하지 않는다.
 */
export function renderInquiry(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const root = el('div', 'iq')

  /* ── 현재 의심 인물 (명세 §22) ── */
  const susBox = el('div', 'iq-sec iq-suspect')
  const cap = el('div', 'iq-cap')
  cap.appendChild(document.createTextNode('지금 가장 의심되는 사람'))
  cap.appendChild(el('span', 'iq-cap-s', '정답 제출이 아니다 — 언제든 바꿀 수 있다'))
  susBox.appendChild(cap)
  const list = el('div', 'iq-people')
  for (const p of v.people) {
    const on1 = v.suspect === p.id
    const b = el('button', `iq-person${on1 ? ' on' : ''}`) as HTMLButtonElement
    b.type = 'button'
    b.setAttribute('aria-pressed', String(on1))
    b.appendChild(el('span', 'iq-radio', on1 ? '●' : '○'))
    b.appendChild(el('span', undefined, p.name))
    // 같은 사람을 다시 누르면 표시를 지운다 — 의심을 거두는 것도 수사다
    b.onclick = () => on.pickSuspect(on1 ? null : p.id)
    list.appendChild(b)
  }
  susBox.appendChild(list)
  root.appendChild(susBox)

  /* ── 다음 질문거리 ── */
  if (v.shaky.length) {
    const sec = el('div', 'iq-sec iq-next')
    sec.appendChild(el('div', 'iq-cap', '확인이 필요한 진술'))
    const ul = el('ul', 'iq-shaky')
    for (const id of v.shaky) {
      const c = v.claims.find((x) => x.id === id)
      if (!c) continue
      ul.appendChild(el('li', undefined, `${c.speakerName}${c.at ? ` · ${c.at}` : ''} — “${c.text}”`))
    }
    sec.appendChild(ul)
    root.appendChild(sec)
  }

  /* ── 진술 ── */
  const claims = el('div', 'iq-sec')
  const ccap = el('div', 'iq-cap')
  ccap.appendChild(document.createTextNode('들은 말'))
  ccap.appendChild(el('span', 'iq-cap-s', `${v.claims.length}건`))
  claims.appendChild(ccap)
  if (v.claims.length === 0) {
    claims.appendChild(el('div', 'iq-empty', '아직 아무 말도 듣지 못했다. 사람을 만나야 한다.'))
  }
  const shown = new Set<string>()
  for (const r of v.claims) {
    if (shown.has(r.id)) continue
    shown.add(r.id)
    claims.appendChild(claimRow(r, false))
    // 고친 말은 **원본 바로 아래**에 붙는다. 원본을 지우지 않는다 (명세 §15)
    if (r.revisedById) {
      const rev = v.claims.find((x) => x.id === r.revisedById)
      if (rev) { shown.add(rev.id); claims.appendChild(claimRow(rev, true)) }
    }
  }
  root.appendChild(claims)

  /* ── 확정된 사실 ── */
  const facts = el('div', 'iq-sec')
  const fcap = el('div', 'iq-cap')
  fcap.appendChild(document.createTextNode('확인된 사실'))
  fcap.appendChild(el('span', 'iq-cap-s', `${v.facts.length}건`))
  facts.appendChild(fcap)
  if (v.facts.length === 0) {
    facts.appendChild(el('div', 'iq-empty', '아직 없다. 기록을 조회하거나 물어야 한다.'))
  }
  for (const f of v.facts) {
    const row = el('div', 'iq-fact')
    row.appendChild(el('div', 'iq-fact-t', f.text))
    row.appendChild(el('div', 'iq-fact-s', `출처 · ${f.source}`))
    facts.appendChild(row)
  }
  root.appendChild(facts)

  /* ── 확보한 기록 ── */
  if (v.evidence.length) {
    const evs = el('div', 'iq-sec')
    evs.appendChild(el('div', 'iq-cap', '확보한 기록'))
    for (const e of v.evidence) {
      const row = el('div', 'iq-ev')
      row.appendChild(el('span', 'iq-ev-t', e.label))
      row.appendChild(el('span', 'iq-ev-s', EV_STATE_LABEL[e.state]))
      evs.appendChild(row)
    }
    root.appendChild(evs)
  }

  /* ── 메모 (명세 §36) ── */
  const memo = el('div', 'iq-sec')
  memo.appendChild(el('div', 'iq-cap', '메모'))
  const ta = el('textarea', 'iq-memo') as HTMLTextAreaElement
  ta.value = v.memo
  ta.rows = 3
  ta.placeholder = '떠오른 것을 적어 둔다 — 시스템은 이것을 읽지 않는다.'
  ta.setAttribute('aria-label', '수사 메모')
  // 전체 재렌더 구조라 입력 중에는 저장만 하고 다시 그리지 않는다 (커서가 튀지 않게)
  ta.onchange = () => on.setMemo(ta.value)
  ta.onblur = () => on.setMemo(ta.value)
  memo.appendChild(ta)
  root.appendChild(memo)

  return root
}
