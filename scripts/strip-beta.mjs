#!/usr/bin/env node
/**
 * 믹사모 FBX 를 "스킨 포함"으로 받으면 Beta_Surface(메시)·Beta_Joints(리그)가
 * 리타게팅 결과에 같이 구워진다 — 우리 리그(TARGET, 0.01 스케일)와 달리 스케일 1이라
 * 키 측정이 31m 로 부풀고 리그 가드에 걸린다. 여기서 Beta_* 루트를 통째로 벗긴다.
 * 사용: node scripts/strip-beta.mjs <in.glb> <out.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'

const [inF, outF] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inF)
const scene = doc.getRoot().getDefaultScene()
let removed = 0
for (const root of [...scene.listChildren()]) {
  const n = root.getName() ?? ''
  if (/^Beta_|^Armature$|mixamo/i.test(n)) { root.dispose(); removed++ }
}
// Beta 본을 타깃하던 애니메이션 채널이 남으면 prune 이 정리한다
await doc.transform(prune())
await io.write(outF, doc)
console.log(`${inF.split('/').pop()}: Beta 루트 ${removed}개 제거`)
