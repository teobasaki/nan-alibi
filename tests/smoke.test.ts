import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('scaffold', () => {
  it('vite config uses relative base (GitHub Pages)', () => {
    expect(readFileSync('vite.config.ts', 'utf-8')).toContain("base: './'")
  })

  it('no API key literal is committed anywhere in src or workers', () => {
    // 키 유출 방지 회귀 테스트 — Workers Secret 외의 경로를 원천 차단
    const files = ['src/main.ts', 'workers/src/index.ts']
    for (const f of files) {
      expect(readFileSync(f, 'utf-8')).not.toMatch(/sk-ant-[A-Za-z0-9_-]/)
    }
  })
})
