import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? allFiles(p) : [p]
  })
}

describe('scaffold', () => {
  it('vite config uses relative base', () => {
    expect(readFileSync('vite.config.ts', 'utf-8')).toContain("base: './'")
  })

  it('API 엔드포인트가 게임과 같은 오리진에 있다 (CORS 불필요)', () => {
    expect(readFileSync('functions/api/interrogate.ts', 'utf-8')).not.toContain(
      'Access-Control-Allow-Origin',
    )
  })

  it('키가 없으면 폴백 신호를 반환한다 (게임이 멈추면 안 된다)', () => {
    const src = readFileSync('functions/api/interrogate.ts', 'utf-8')
    expect(src).toContain('fallback: true')
  })

  it('소스 어디에도 API 키 리터럴이 없다', () => {
    for (const f of [...allFiles('src'), ...allFiles('functions'), 'wrangler.toml']) {
      expect(readFileSync(f, 'utf-8'), f).not.toMatch(/sk-(ant|proj|or)-[A-Za-z0-9_-]{8}/)
    }
  })
})
