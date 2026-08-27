/** V0.2 수사일지 — 관찰을 기록하고, 플레이어가 직접 가설과 연결을 편집한다. */
import '../styles/inquiry.css'
import type {
  ClaimState, EvidenceState, Hypothesis, HypothesisStatus, InquiryState,
} from '../engine/inquiry'
import type { SuspectId } from '../types'

export type InquiryTab = 'overview' | 'evidence' | 'testimony' | 'timeline' | 'deduction'

export interface InquiryClaimRow {
  id: string; speaker: SuspectId; speakerName: string; text: string; at?: string
  state: ClaimState; revisedById?: string
}
export interface InquiryFactRow { id: string; text: string; source: string }
export interface InquiryEvidenceRow { id: string; label: string; state: EvidenceState }
export interface InquiryClueRow {
  id: string; kind: 'CLAIM' | 'FACT' | 'EVIDENCE'; label: string; detail?: string
}
export interface InquiryView {
  claims: InquiryClaimRow[]
  facts: InquiryFactRow[]
  evidence: InquiryEvidenceRow[]
  clues: InquiryClueRow[]
  shaky: string[]
  suspect: SuspectId | null
  people: { id: SuspectId; name: string }[]
  memo: string
  hypotheses: Hypothesis[]
  links: [string, string][]
  activeTab: InquiryTab
}
export interface InquiryHandlers {
  changeTab(tab: InquiryTab): void
  pickSuspect(id: SuspectId | null): void
  setMemo(text: string): void
  saveHypothesis(h: Hypothesis): void
  removeHypothesis(id: string): void
  addLink(a: string, b: string): void
  removeLink(a: string, b: string): void
  openProof(): void
}

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  KNOWN: '들었다', QUESTIONABLE: '확인이 필요하다', CHALLENGED: '추궁했다',
  REVISED: '고쳐 말했다', CONFIRMED: '기록과 맞는다', DISPROVED: '기록과 어긋난다',
}
const EV_STATE_LABEL: Record<EvidenceState, string> = {
  AVAILABLE: '아직 못 봤다', DISCOVERED: '확보', UNDERSTOOD: '의미 확인',
}
const HYPOTHESIS_LABEL: Record<HypothesisStatus, string> = {
  DRAFT: '초안', SUPPORTED: '지지됨', CONTESTED: '반론 있음', DISPROVED: '기각', PROVEN: '입증',
}
const TABS: { id: InquiryTab; no: string; label: string }[] = [
  { id: 'overview', no: '01', label: '사건 개요' }, { id: 'evidence', no: '02', label: '증거' },
  { id: 'testimony', no: '03', label: '증언' }, { id: 'timeline', no: '04', label: '타임라인' },
  { id: 'deduction', no: '05', label: '추론' },
]

export interface InquirySource {
  claim(id: string): { speaker: SuspectId; text: string; at?: string; revisedTo?: string } | undefined
  fact(id: string): { text: string; source: string } | undefined
  suspectName(id: SuspectId): string
  evidenceLabel(id: string): string
  people: { id: SuspectId; name: string }[]
}

export function inquiryView(
  s: InquiryState, src: InquirySource, shaky: string[], activeTab: InquiryTab = 'overview',
): InquiryView {
  const claims: InquiryClaimRow[] = []
  for (const [id, track] of Object.entries(s.claims)) {
    const def = src.claim(id); if (!def) continue
    claims.push({ id, speaker: def.speaker, speakerName: src.suspectName(def.speaker), text: def.text,
      ...(def.at ? { at: def.at } : {}), state: track.state,
      ...(def.revisedTo && s.claims[def.revisedTo] ? { revisedById: def.revisedTo } : {}) })
  }
  const order = new Map(src.people.map((p, i) => [p.id, i]))
  claims.sort((a, b) => (order.get(a.speaker) ?? 9) - (order.get(b.speaker) ?? 9)
    || (a.at ?? '').localeCompare(b.at ?? ''))
  const facts = s.facts.map((id) => { const f = src.fact(id); return f ? { id, ...f } : null })
    .filter((x): x is InquiryFactRow => x !== null)
  const evidence = Object.entries(s.evidence).filter(([, st]) => st !== 'AVAILABLE')
    .map(([id, state]) => ({ id, label: src.evidenceLabel(id), state }))
  const clues: InquiryClueRow[] = [
    ...claims.map((c) => ({ id: c.id, kind: 'CLAIM' as const,
      label: `${c.speakerName}${c.at ? ` · ${c.at}` : ''} — “${c.text}”`, detail: CLAIM_STATE_LABEL[c.state] })),
    ...facts.map((f) => ({ id: f.id, kind: 'FACT' as const, label: f.text, detail: `출처 · ${f.source}` })),
    ...evidence.map((e) => ({ id: e.id, kind: 'EVIDENCE' as const, label: e.label, detail: EV_STATE_LABEL[e.state] })),
  ]
  return { claims, facts, evidence, clues, shaky, suspect: s.suspect, people: src.people,
    memo: s.memo, hypotheses: s.hypotheses, links: s.links, activeTab }
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag); if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}
const cap = (title: string, tally?: string): HTMLElement => {
  const n = el('div', 'iq-cap', title); if (tally) n.appendChild(el('span', 'iq-cap-s', tally)); return n
}
function claimRow(r: InquiryClaimRow, isRevision: boolean): HTMLElement {
  const box = el('div', `iq-claim s-${r.state.toLowerCase()}${isRevision ? ' rev' : ''}`)
  const head = el('div', 'iq-claim-h')
  head.append(el('span', 'iq-who', isRevision ? '고친 말' : r.speakerName))
  if (r.at) head.append(el('span', 'iq-at', r.at))
  head.append(el('span', 'iq-state', CLAIM_STATE_LABEL[r.state]))
  box.append(head, el('div', 'iq-quote', `“${r.text}”`)); return box
}
function claimsSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('들은 말', `${v.claims.length}건`))
  if (!v.claims.length) sec.appendChild(el('div', 'iq-empty', '아직 아무 말도 듣지 못했다.'))
  const shown = new Set<string>()
  for (const r of v.claims) {
    if (shown.has(r.id)) continue; shown.add(r.id); sec.appendChild(claimRow(r, false))
    if (r.revisedById) { const rev = v.claims.find((x) => x.id === r.revisedById)
      if (rev) { shown.add(rev.id); sec.appendChild(claimRow(rev, true)) } }
  }
  return sec
}
function factsSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('확인된 사실', `${v.facts.length}건`))
  if (!v.facts.length) sec.appendChild(el('div', 'iq-empty', '기록을 조회하거나 물어야 한다.'))
  for (const f of v.facts) { const row = el('div', 'iq-fact'); row.append(el('div', 'iq-fact-t', f.text), el('div', 'iq-fact-s', `출처 · ${f.source}`)); sec.appendChild(row) }
  return sec
}
function evidenceSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('확보한 기록', `${v.evidence.length}건`))
  if (!v.evidence.length) sec.appendChild(el('div', 'iq-empty', '아직 확보한 기록이 없다.'))
  for (const e of v.evidence) { const row = el('div', 'iq-ev'); row.append(el('span', 'iq-ev-t', e.label), el('span', 'iq-ev-s', EV_STATE_LABEL[e.state])); sec.appendChild(row) }
  return sec
}
function suspectSection(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const sec = el('section', 'iq-sec iq-suspect'); sec.appendChild(cap('지금 가장 의심되는 사람', '정답 제출이 아니다'))
  const list = el('div', 'iq-people')
  for (const p of v.people) { const active = v.suspect === p.id; const b = el('button', `iq-person${active ? ' on' : ''}`) as HTMLButtonElement
    b.type = 'button'; b.setAttribute('aria-pressed', String(active)); b.append(el('span', 'iq-radio', active ? '●' : '○'), el('span', undefined, p.name)); b.onclick = () => on.pickSuspect(active ? null : p.id); list.appendChild(b) }
  sec.appendChild(list); return sec
}
function memoSection(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('메모'))
  const ta = el('textarea', 'iq-memo') as HTMLTextAreaElement; ta.value = v.memo; ta.rows = 4
  ta.placeholder = '떠오른 것을 적어 둔다 — 시스템은 이것을 읽지 않는다.'; ta.setAttribute('aria-label', '수사 메모')
  ta.onchange = ta.onblur = () => on.setMemo(ta.value); sec.appendChild(ta); return sec
}
function clueSelect(v: InquiryView, placeholder: string, used: string[], add: (id: string) => void): HTMLSelectElement {
  const s = el('select', 'iq-clue-select') as HTMLSelectElement
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; s.appendChild(first)
  for (const c of v.clues.filter((x) => !used.includes(x.id))) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; s.appendChild(o) }
  s.onchange = () => { if (s.value) add(s.value) }; return s
}
function clueTags(v: InquiryView, ids: string[], remove: (id: string) => void): HTMLElement {
  const box = el('div', 'iq-hyp-tags')
  for (const id of ids) { const c = v.clues.find((x) => x.id === id); const b = el('button', 'iq-hyp-tag', `${c?.label ?? id}  ×`) as HTMLButtonElement; b.type = 'button'; b.onclick = () => remove(id); box.appendChild(b) }
  return box
}
function hypothesisCard(v: InquiryView, h: Hypothesis, on: InquiryHandlers): HTMLElement {
  const card = el('article', 'iq-hyp')
  const top = el('div', 'iq-hyp-top'); top.appendChild(el('span', 'iq-hyp-id', h.id))
  const status = el('select', 'iq-hyp-status') as HTMLSelectElement
  for (const st of Object.keys(HYPOTHESIS_LABEL) as HypothesisStatus[]) { const o = document.createElement('option'); o.value = st; o.textContent = HYPOTHESIS_LABEL[st]; o.selected = h.status === st; status.appendChild(o) }
  status.setAttribute('aria-label', '가설 상태'); status.onchange = () => on.saveHypothesis({ ...h, status: status.value as HypothesisStatus }); top.appendChild(status)
  const del = el('button', 'iq-hyp-del', '삭제') as HTMLButtonElement; del.type = 'button'; del.onclick = () => on.removeHypothesis(h.id); top.appendChild(del); card.appendChild(top)
  const ta = el('textarea', 'iq-hyp-text') as HTMLTextAreaElement; ta.value = h.proposition; ta.rows = 2; ta.setAttribute('aria-label', '가설 내용'); ta.onchange = () => on.saveHypothesis({ ...h, proposition: ta.value }); card.appendChild(ta)
  const who = el('select', 'iq-hyp-who') as HTMLSelectElement; const none = document.createElement('option'); none.value = ''; none.textContent = '관련 인물 없음'; who.appendChild(none)
  for (const p of v.people) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; o.selected = h.subjectId === p.id; who.appendChild(o) }
  who.onchange = () => { const id = who.value as SuspectId; const next = { ...h }; if (id) next.subjectId = id; else delete next.subjectId; on.saveHypothesis(next) }; card.appendChild(who)
  const roles: ['supportClueIds' | 'counterClueIds', string, string][] = [
    ['supportClueIds', '지지 근거', '+ 지지 근거'], ['counterClueIds', '반대 근거', '+ 반대 근거'],
  ]
  for (const [key, label, placeholder] of roles) { const box = el('div', `iq-hyp-role ${key === 'supportClueIds' ? 'support' : 'counter'}`); box.appendChild(el('div', 'iq-hyp-role-k', label)); box.appendChild(clueTags(v, h[key], (id) => on.saveHypothesis({ ...h, [key]: h[key].filter((x) => x !== id) })))
    box.appendChild(clueSelect(v, placeholder, [...h.supportClueIds, ...h.counterClueIds], (id) => on.saveHypothesis({ ...h, [key]: [...h[key], id] }))); card.appendChild(box) }
  return card
}
function deduction(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const wrap = el('div', 'iq-deduction')
  const hs = el('section', 'iq-sec'); const hd = cap('내 가설', `${v.hypotheses.length}개`)
  const add = el('button', 'iq-add', '+ 가설 세우기') as HTMLButtonElement; add.type = 'button'; add.onclick = () => { let n = 1; while (v.hypotheses.some((h) => h.id === `H-${n}`)) n += 1; on.saveHypothesis({ id: `H-${n}`, proposition: '새 가설', supportClueIds: [], counterClueIds: [], proofPropositionIds: [], status: 'DRAFT' }) }; hd.appendChild(add); hs.appendChild(hd)
  if (!v.hypotheses.length) hs.appendChild(el('div', 'iq-empty', '가설을 세우고 지지 근거와 반대 근거를 직접 붙인다.'))
  for (const h of v.hypotheses) hs.appendChild(hypothesisCard(v, h, on)); wrap.appendChild(hs)
  const ls = el('section', 'iq-sec iq-links'); ls.appendChild(cap('단서 연결', `${v.links.length}개`))
  const row = el('div', 'iq-link-new'); let a = ''; let b = ''
  const aSel = clueSelect(v, '첫 단서', [], (id) => { a = id }); const bSel = clueSelect(v, '둘째 단서', [], (id) => { b = id })
  const linkBtn = el('button', 'iq-link-add', '연결') as HTMLButtonElement; linkBtn.type = 'button'; linkBtn.onclick = () => { a = a || aSel.value; b = b || bSel.value; if (a && b && a !== b) on.addLink(a, b) }; row.append(aSel, el('span', 'iq-link-arrow', '↔'), bSel, linkBtn); ls.appendChild(row)
  for (const [aId, bId] of v.links) { const r = el('div', 'iq-link'); r.append(el('span', undefined, v.clues.find((c) => c.id === aId)?.label ?? aId), el('span', 'iq-link-arrow', '↔'), el('span', undefined, v.clues.find((c) => c.id === bId)?.label ?? bId)); const x = el('button', undefined, '끊기') as HTMLButtonElement; x.type = 'button'; x.onclick = () => on.removeLink(aId, bId); r.appendChild(x); ls.appendChild(r) }
  wrap.appendChild(ls)
  const proof = el('button', 'iq-proof', '이 연결로 최종 논증을 짠다') as HTMLButtonElement; proof.type = 'button'; proof.onclick = () => on.openProof(); wrap.appendChild(proof)
  return wrap
}

export function renderInquiry(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const root = el('div', 'iq iq-notebook')
  const nav = el('div', 'iq-tabs'); nav.setAttribute('role', 'tablist')
  for (const t of TABS) { const active = v.activeTab === t.id; const b = el('button', `iq-tab${active ? ' on' : ''}`) as HTMLButtonElement; b.type = 'button'; b.dataset.tab = t.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(active)); b.append(el('span', 'iq-tab-no', t.no), el('span', 'iq-tab-label', t.label)); b.onclick = () => on.changeTab(t.id); nav.appendChild(b) }
  root.appendChild(nav)
  const page = el('div', `iq-page tab-${v.activeTab}`); page.setAttribute('role', 'tabpanel')
  if (v.activeTab === 'overview') {
    page.append(suspectSection(v, on))
    if (v.shaky.length) { const sec = el('section', 'iq-sec iq-next'); sec.appendChild(cap('확인이 필요한 진술', `${v.shaky.length}건`)); const ul = el('ul', 'iq-shaky'); for (const id of v.shaky) { const c = v.claims.find((x) => x.id === id); if (c) ul.appendChild(el('li', undefined, `${c.speakerName}${c.at ? ` · ${c.at}` : ''} — “${c.text}”`)) } sec.appendChild(ul); page.appendChild(sec) }
    const cards = el('div', 'iq-overview-grid'); cards.append(factsSection(v), claimsSection(v)); page.appendChild(cards); page.appendChild(memoSection(v, on))
  } else if (v.activeTab === 'evidence') page.append(evidenceSection(v), factsSection(v))
  else if (v.activeTab === 'testimony') page.appendChild(claimsSection(v))
  else if (v.activeTab === 'timeline') {
    const sec = el('section', 'iq-sec iq-timeline'); sec.appendChild(cap('사건 타임라인', `${v.claims.filter((c) => c.at).length}개 시각`))
    for (const c of [...v.claims].filter((x) => x.at).sort((a, b) => a.at!.localeCompare(b.at!))) { const r = el('div', 'iq-time'); r.append(el('time', undefined, c.at), el('span', 'iq-time-who', c.speakerName), el('span', 'iq-time-text', c.text)); sec.appendChild(r) } page.appendChild(sec)
  } else page.appendChild(deduction(v, on))
  root.appendChild(page); return root
}
