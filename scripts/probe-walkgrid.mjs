#!/usr/bin/env node
/**
 * 탐색 씬의 **충돌 격자를 브라우저 없이 재본다.**
 *
 * 왜 있나: 벽 충돌을 붙였더니 인물이 안 움직였다. 브라우저에서 원인을 찾으려니
 * 렌더가 느려 측정이 매번 시간초과였다. 같은 계산을 Node 에서 하면 몇 초다.
 *
 * 높이 띠(LO~HI)만 바꿔가며 돌리면 **어느 띠가 벽만 잡는지** 숫자로 나온다 —
 * 실제로 이 스크립트가 0.8~1.7m(23% 막힘, 좌석 2개 매몰)를 버리고
 * 2.0~3.0m(9%, 고립 0, 매몰 0)를 고르게 했다.
 *
 *   node scripts/probe-walkgrid.mjs
 *   LO=1.6 HI=2.6 node scripts/probe-walkgrid.mjs
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
})
const doc = await io.read('public/room/station.opt.glb')
const HX=13, HZ=8, CELL=0.5
const LO=Number(process.env.LO??2.0), HI=Number(process.env.HI??3.0)
const GW=Math.ceil(HX*2/CELL)+1, GH=Math.ceil(HZ*2/CELL)+1
const solid=new Uint8Array(GW*GH)
let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,minY=1e9,maxY=-1e9,verts=0
for (const node of doc.getRoot().listNodes()) {
  const mesh=node.getMesh(); if(!mesh) continue
  const name=node.getName()
  const hidden=/ceiling/i.test(name)
  const m=node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const pos=prim.getAttribute('POSITION'); if(!pos) continue
    const a=[0,0,0]
    for(let i=0;i<pos.getCount();i++){
      pos.getElement(i,a)
      const x=m[0]*a[0]+m[4]*a[1]+m[8]*a[2]+m[12]
      const y=m[1]*a[0]+m[5]*a[1]+m[9]*a[2]+m[13]
      const z=m[2]*a[0]+m[6]*a[1]+m[10]*a[2]+m[14]
      verts++
      if(x<minX)minX=x; if(x>maxX)maxX=x
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z
      if(y<minY)minY=y; if(y>maxY)maxY=y
      if(hidden) continue
      if(y<LO||y>HI) continue
      if(x<-HX||x>HX||z<-HZ||z>HZ) continue
      solid[Math.round((z+HZ)/CELL)*GW+Math.round((x+HX)/CELL)]=1
    }
  }
}
let s=0; for(const c of solid) if(c) s++
console.log(JSON.stringify({verts, bbox:{x:[minX.toFixed(1),maxX.toFixed(1)],y:[minY.toFixed(1),maxY.toFixed(1)],z:[minZ.toFixed(1),maxZ.toFixed(1)]},
  격자:`${GW}x${GH}`, 막힌칸:s, 전체:solid.length, 비율:(s/solid.length*100).toFixed(0)+'%'}))
// 시작점에서 **걸어서 닿는** 칸만 남긴다 (BFS)
const SPAWN=[0,5]
const idx=(x,z)=>Math.round((z+HZ)/CELL)*GW+Math.round((x+HX)/CELL)
const reach=new Uint8Array(GW*GH)
const q=[idx(SPAWN[0],SPAWN[1])]
if(!solid[q[0]]) reach[q[0]]=1; else console.log('시작점이 막혀 있다')
for(let h=0;h<q.length;h++){ const i=q[h], r=(i/GW)|0, c=i%GW
  for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nr=r+dr,nc=c+dc
    if(nr<0||nr>=GH||nc<0||nc>=GW) continue
    const n=nr*GW+nc; if(solid[n]||reach[n]) continue
    reach[n]=1; q.push(n) } }
let rc=0; for(const c of reach) if(c) rc++
let free=0; for(const c of solid) if(!c) free++
console.log(JSON.stringify({빈칸:free, 도달칸:rc, 고립:free-rc}))
const SEATS=[[-5,1.5],[-2.5,3],[0,1.5],[2.5,3],[5,1.5]]
const PLACES=[[-9.5,5.5],[9.5,5.5],[0,-6.5],[-9.5,-5],[9.5,-5]]
const chk=(n,a)=>a.map(([x,z],i)=>`${n}${i} (${x},${z}) ${solid[idx(x,z)]?'벽':reach[idx(x,z)]?'✓도달':'✗고립'}`)
console.log([...chk('좌석',SEATS),...chk('장소',PLACES)].join('\n'))
let out=''
for(let r=0;r<GH;r++){ let line=''
  for(let c=0;c<GW;c++){ const i=r*GW+c; line += solid[i]?'#':reach[i]?' ':'.' }
  out+=line+'\n' }
console.log('\n# 벽 · (공백) 도달 · . 고립\n'+out)
