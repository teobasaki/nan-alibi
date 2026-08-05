import { describe, it } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { solve, candidatesFrom } from '../src/engine/solver'
import { createGame, availableEvidence } from '../src/engine/game'
import { PLACE_LABEL, SLOT_LABEL, SUSPECTS, CRIME_SLOT } from '../src/types'
import { personaById } from '../src/data/personas'

const SEED = Number(process.env.TRACE_SEED ?? 4242)

describe('사건 트레이스 (밸런스 논의용 · 항상 통과)', () => {
  it(`시드 ${SEED}`, () => {
    const g = generateValidCase(SEED)
    const c = g.case
    const L = console.log
    L(`\n═══ ${c.title} · ${c.venue.name} ${c.venue.room} · 피해자 ${c.victim.name} ═══`)
    L(`진범: ${c.suspects[c.culprit].name} (${c.culprit}) · 동기 ${c.motive} · 수단 ${c.method}`)
    L(`최소 조사 수 m* = ${g.validation.solve.minActions}`)
    L(`최적 경로: ${g.validation.solve.path.join('  →  ')}`)

    L(`\n── 플레이어가 처음 보는 것 (무료) ──`)
    for (const s of SUSPECTS) {
      const x = c.suspects[s]
      const p = personaById(x.personaId)
      L(`  ${x.name.padEnd(4)} ${x.job.padEnd(9)} | "${SLOT_LABEL[CRIME_SLOT]}엔 ${PLACE_LABEL[x.claim[CRIME_SLOT]!]}" | 성향 ${p.label} — ${p.hint}`)
    }

    L(`\n── 즉시 조회 가능한 기록 ──`)
    for (const e of availableEvidence(createGame(c))) {
      L(`  ${e.id}  ${e.kind.padEnd(8)} ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}  → 확정: ${e.subjects.map((x) => c.suspects[x].name).join(', ')}`)
    }
    L(`\n── 잠겨 있는 기록 ──`)
    for (const e of c.evidence.filter((e) => e.requires.length)) {
      L(`  ${e.id}  ${e.kind.padEnd(8)} ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}  ← 선행: ${e.requires.join(', ')}${e.decisive ? '  ★결정적' : ''}`)
    }

    L(`\n── 진실 vs 진술 (플레이어는 진실을 못 본다) ──`)
    for (const s of SUSPECTS) {
      const x = c.suspects[s]
      const rows = x.truth.map((t, i) =>
        x.lieSlots.includes(i as 0)
          ? `${SLOT_LABEL[i as 0]}:${PLACE_LABEL[x.claim[i]!]}(거짓,실제${PLACE_LABEL[t]})`
          : `${SLOT_LABEL[i as 0]}:${PLACE_LABEL[t]}`)
      L(`  ${x.name.padEnd(4)}${x.isCulprit ? '★' : ' '} ${rows.join('  ')}`)
      if (x.lieSlots.length) L(`        └ 거짓말 이유: ${x.lieReason}`)
    }

    L(`\n── 조사 0회 시점 후보: ${candidatesFrom(c, new Set()).length}명 ──`)
    L(`── 알리바이만으로 푸는 경로 비용: ${c.evidence.filter((e) => e.slot === CRIME_SLOT && e.place !== 2 && !e.requires.length).length}회`)
    L(`── 사슬 경로 비용: ${solve(c).minActions}회\n`)
  })
})
