#!/bin/bash
# 시점 4장이 갖춰진 인물을 전부 3D 로 굽는다.
# 멀티뷰 → 리깅 → 착석 → PBR 복원 → 압축까지 한 번에.
set -u
cd "$(dirname "$0")/.."
for slug in "$@"; do
  echo "══ $slug ══"
  n=$(ls public/refs/${slug}-{front,left,right,back}.png 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "4" ]; then echo "  시점 ${n}/4 — 건너뜀"; continue; fi
  if [ -f "assets-src/${slug}.mvrigged.glb" ]; then
    echo "  이미 리깅됨 — 생성 건너뜀"
  else
    node scripts/multiview2char.mjs "$slug" 2>&1 | grep -E "메시|리깅|맵|합계|⚠️|Error" || { echo "  ✗ 생성 실패"; continue; }
    mv public/characters/${slug}.mv.glb public/characters/${slug}.mvrigged.glb assets-src/ 2>/dev/null
  fi
  [ -f "assets-src/${slug}.mvrigged.glb" ] || { echo "  ✗ 리깅 결과 없음"; continue; }
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/pose-seated.py -- \
    "assets-src/${slug}.mvrigged.glb" "assets-src/${slug}.mvseated.glb" 2>&1 | grep -E "팔:|앉힘" 
  node scripts/restore-pbr.mjs "assets-src/${slug}.mv.glb" "assets-src/${slug}.mvseated.glb" "assets-src/${slug}.pbr.glb" 2>&1 | grep -E "복원"
  npx gltf-transform optimize "assets-src/${slug}.pbr.glb" "public/characters/${slug}.opt.glb" \
    --texture-size 2048 --texture-compress webp --compress draco --simplify false 2>&1 | grep "→"
done
echo "══ 완료 ══"
