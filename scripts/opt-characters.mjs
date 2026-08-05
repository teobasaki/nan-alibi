#!/usr/bin/env node
/**
 * 캐릭터 GLB 최적화 — 배포 전에 반드시 돈다.
 *
 * Meshy 리깅 출력은 1명당 **9MB** 다. 8명이면 73MB — 60초 시연이 로딩으로 끝난다.
 * 텍스처를 768로 줄이고 webp + Draco 를 걸면 **0.34MB** 가 된다 (실측 27배).
 *
 * 폴리곤 감축(`--simplify`)은 0.10MB 까지 내려가지만 스킨 가중치를 건드려
 * 리그가 상할 수 있다. 기본값은 **끄고**, 뷰어에서 확인한 뒤에만 켠다.
 *
 * 원본(`<slug>.rigged.glb`)은 지우지 않는다 — 설정을 바꿔 다시 뽑으려면 필요하고,
 * 크레딧을 다시 태우는 것보다 디스크가 싸다. 번들에는 `.opt.glb` 만 들어간다.
 */
import { readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DIR = 'public/characters'
const SIZE = process.env.TEXTURE_SIZE ?? '768'
const SIMPLIFY = process.env.SIMPLIFY === '1'

if (!existsSync(DIR)) { console.log('캐릭터 폴더가 없다.'); process.exit(0) }

const srcs = readdirSync(DIR).filter((f) => f.endsWith('.rigged.glb'))
if (srcs.length === 0) { console.log('최적화할 .rigged.glb 가 없다.'); process.exit(0) }

const mb = (p) => statSync(p).size / 1048576
let before = 0, after = 0

for (const f of srcs) {
  const slug = f.replace(/\.rigged\.glb$/, '')
  const src = `${DIR}/${f}`
  const out = `${DIR}/${slug}.opt.glb`
  const args = [
    'gltf-transform', 'optimize', src, out,
    '--texture-size', SIZE, '--texture-compress', 'webp', '--compress', 'draco',
    '--simplify', SIMPLIFY ? 'true' : 'false',
  ]
  try {
    execFileSync('npx', args, { stdio: 'pipe' })
    before += mb(src); after += mb(out)
    console.log(`  ${slug}: ${mb(src).toFixed(1)}MB → ${mb(out).toFixed(2)}MB`)
  } catch (e) {
    console.error(`  ✗ ${slug} 실패: ${String(e.stderr ?? e).slice(0, 200)}`)
  }
}
console.log(`\n합계 ${before.toFixed(1)}MB → ${after.toFixed(2)}MB (텍스처 ${SIZE}, 폴리곤 감축 ${SIMPLIFY ? 'ON' : 'OFF'})`)
