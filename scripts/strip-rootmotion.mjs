/**
 * 클립에 구워진 **루트 모션(전진 이동)** 을 떼어낸다 — 제자리 클립으로 만든다.
 *
 * ## 왜 필요했나 (2026-08-10 실측)
 * joe.run 은 Mixamo "Standard Run" 을 "In Place" 체크 없이 받은 클립이라
 * 골반(Hips) 트랙에 **한 사이클당 3.24m 전진**이 통째로 들어 있었다
 * (이동폭: walk 8cm · idle 19cm · run 324cm). 게임은 캐릭터 그룹 위치를
 * 코드로 움직이므로, 애니메이션이 메시를 또 끌고 나가면
 * **혼자 달려나갔다가 루프 끝에 제자리로 튕겨 돌아오는** 증상이 된다.
 *
 * ## 무엇을 하나
 * 골반 translation 트랙에서 이동폭이 THRESH(50cm)를 넘는 축만
 * 첫 프레임 값으로 고정한다 — 전진은 죽고, 위아래 출렁임(bob)과
 * 좌우 흔들림은 살아남는다. 임계 아래 축은 손대지 않으므로
 * walk·idle 에 돌려도 무해하다(멱등).
 *
 * 사용: node scripts/strip-rootmotion.mjs <in.glb> [out.glb]
 *       (out 생략 시 제자리 덮어쓰기)
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const THRESH = 50 // cm — 이보다 크게 움직이는 축은 bob 이 아니라 이동이다

const [inPath, outPath = inPath] = process.argv.slice(2)
if (!inPath) {
  console.error('사용: node scripts/strip-rootmotion.mjs <in.glb> [out.glb]')
  process.exit(1)
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
})

const doc = await io.read(inPath)
let touched = 0
for (const anim of doc.getRoot().listAnimations()) {
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode()
    if (!node || ch.getTargetPath() !== 'translation') continue
    if (!/hip|root|pelvis/i.test(node.getName())) continue
    const acc = ch.getSampler().getOutput()
    const arr = acc.getArray()
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity, max = -Infinity
      for (let i = axis; i < arr.length; i += 3) {
        if (arr[i] < min) min = arr[i]
        if (arr[i] > max) max = arr[i]
      }
      const range = max - min
      if (range <= THRESH) continue
      const first = arr[axis]
      for (let i = axis; i < arr.length; i += 3) arr[i] = first
      touched++
      console.log(`${anim.getName()} | ${node.getName()} | 축 ${'xyz'[axis]} 이동폭 ${range.toFixed(1)} → 고정`)
    }
    acc.setArray(arr)
  }
}

if (!touched) {
  console.log('고정할 축 없음 — 이미 제자리 클립이다:', inPath)
  process.exit(0)
}
await io.write(outPath, doc)
console.log(`저장: ${outPath} (고정한 축 ${touched}개)`)
