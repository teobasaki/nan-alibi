/**
 * 모프 타깃(블렌드셰이프) 제거 — Character Creator 계열 스캔 캐릭터 다이어트.
 *
 * alina 실측: 4,354 버텍스 얼굴 메시가 15.79MB — 표정 모프 ~50개가 원인이었다.
 * 이 게임은 표정을 tell 연출(자세·카메라)로만 하고 모프를 재생하지 않으므로
 * 전부 걷어낸다. 사용: node scripts/strip-morphs.mjs <in.glb> <out.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('사용: node scripts/strip-morphs.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
})

const doc = await io.read(inPath)
let removed = 0
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const target of prim.listTargets()) {
      prim.removeTarget(target)
      target.dispose()
      removed++
    }
  }
  mesh.setWeights([])
}
// 모프를 참조하던 애니메이션 weights 채널도 죽은 참조가 되므로 prune 이 정리한다
await doc.transform(prune())
await io.write(outPath, doc)
console.log(`모프 타깃 ${removed}개 제거 → ${outPath}`)
