/**
 * 대사 청크 분할 — **첫 소리를 앞당기는 산수**를 게이트가 본다.
 *
 * 합성 지연은 글자 수에 비례한다. 앞 몇 단어만 먼저 보내면 그 조각이 먼저 돌아오고,
 * 나머지는 그 사이 병렬로 합성된다. 여기서 잠그는 것은 하나다 —
 * **쪼개도 말이 손실되지 않는다.** 붙이면 원문이어야 한다(공백 차이만 허용).
 */
import { describe, it, expect } from 'vitest'
import { chunkSpeech } from '../src/ui/tts/supertone'

const joined = (s: string): string => chunkSpeech(s).join(' ').replace(/\s+/g, ' ').trim()
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

describe('대사 청크 — 첫 조각은 짧게, 말은 잃지 않는다', () => {
  it('빈 문자열은 조각이 없다', () => {
    expect(chunkSpeech('')).toEqual([])
    expect(chunkSpeech('   ')).toEqual([])
  })

  it('짧은 한 문장은 그대로 한 조각이다 — 쪼갤 이득이 없다', () => {
    const s = '모릅니다.'
    expect(chunkSpeech(s)).toEqual([s])
  })

  it('긴 첫 문장은 앞 세 단어를 떼어낸다 — 그 조각이 먼저 돌아온다', () => {
    const s = '그 시간엔 계속 큐레이터 데스크에 앉아 서류를 정리하고 있었습니다.'
    const out = chunkSpeech(s)
    expect(out.length).toBeGreaterThan(1)
    expect(out[0]!.split(/\s+/)).toHaveLength(3)
    // 첫 조각이 원문보다 확실히 짧아야 이득이 있다
    expect(out[0]!.length).toBeLessThan(s.length / 2)
  })

  it('여러 문장은 문장 경계로 갈린다 — 문장 중간을 자르지 않는다', () => {
    const s = '아니요. 저는 거기 없었습니다. 왜 그걸 묻습니까?'
    const out = chunkSpeech(s)
    expect(out.length).toBeGreaterThanOrEqual(3)
    for (const c of out.slice(1)) expect(c.trim()).not.toBe('')
  })

  it('★ 쪼갠 것을 붙이면 원문이다 — 말이 새지 않는다', () => {
    for (const s of [
      '모릅니다.',
      '그 시간엔 계속 큐레이터 데스크에 앉아 있었습니다.',
      '아니요. 저는 거기 없었습니다. 왜 그걸 묻습니까?',
      '21시 18분에 잠깐 반입문 앞에 나갔습니다. 그게 전부입니다.',
      '…글쎄요, 기억이 잘 안 납니다',
    ]) {
      expect(joined(s)).toBe(norm(s))
    }
  })

  it('빈 조각을 내보내지 않는다 — 빈 요청은 합성 실패로 돌아온다', () => {
    for (const s of ['아. 어. 음.', '네!!! 정말요???', '   여러   공백   사이   ']) {
      for (const c of chunkSpeech(s)) expect(c.trim().length).toBeGreaterThan(0)
    }
  })
})
