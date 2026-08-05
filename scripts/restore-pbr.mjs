#!/usr/bin/env node
/**
 * PBR 맵 복원 — **Meshy 리깅이 노멀맵을 떨어뜨린다.**
 *
 * 실측으로 확인한 것:
 *   리깅 전(`.mv.glb`)  : baseColor, emissive, **normal, metallicRoughness**
 *   리깅 후(`.mvrigged`): baseColor, emissive 만
 *
 * 노멀맵이 없으면 표면 미세 요철(천의 짜임, 피부 결, 단추 주변 그림자)이 전부 사라지고
 * 빛이 매끈한 면에 균일하게 반사된다 — **그게 "레고처럼 보인다" 의 정확한 원인**이었다.
 *
 * 그래서 리깅 전 파일에서 맵을 꺼내 리깅 후 파일의 재질에 다시 붙인다.
 * 두 파일은 같은 UV 를 쓰므로 그대로 얹힌다.
 *
 * 사용법: node scripts/restore-pbr.mjs <소스.glb> <대상.glb> [출력.glb]
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const [src, dst, out = dst] = process.argv.slice(2)
if (!src || !dst) {
  console.error('사용법: node scripts/restore-pbr.mjs <맵을 가진 glb> <맵이 빠진 glb> [출력]')
  process.exit(1)
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })

const from = await io.read(src)
const to = await io.read(dst)

const srcMat = from.getRoot().listMaterials()[0]
if (!srcMat) throw new Error(`${src} 에 재질이 없다`)

const copyTex = (getter, setter, infoGetter, infoSetter, label) => {
  const tex = srcMat[getter]()
  if (!tex) return `${label}: 원본에 없음`
  const clone = to.createTexture(tex.getName() || label)
    .setImage(tex.getImage())
    .setMimeType(tex.getMimeType())
  let n = 0
  for (const m of to.getRoot().listMaterials()) {
    m[setter](clone)
    // UV 채널·타일링 정보도 함께 옮긴다 — 이걸 빼먹으면 맵이 어긋난다
    const srcInfo = srcMat[infoGetter]?.()
    const dstInfo = m[infoGetter]?.()
    if (srcInfo && dstInfo) dstInfo.setTexCoord(srcInfo.getTexCoord())
    n++
  }
  return `${label}: ${n}개 재질에 복원`
}

console.log(`\n▶ ${src}\n  → ${dst}\n`)
console.log('  ' + copyTex('getNormalTexture', 'setNormalTexture', 'getNormalTextureInfo', null, 'normal'))
console.log('  ' + copyTex('getMetallicRoughnessTexture', 'setMetallicRoughnessTexture', 'getMetallicRoughnessTextureInfo', null, 'metallicRoughness'))

// 노멀 세기와 금속·거칠기 계수도 원본을 따른다
for (const m of to.getRoot().listMaterials()) {
  m.setNormalScale(srcMat.getNormalScale())
  m.setMetallicFactor(srcMat.getMetallicFactor())
  m.setRoughnessFactor(srcMat.getRoughnessFactor())
}

await io.write(out, to)
console.log(`\n  저장: ${out}\n`)
