#!/bin/bash
#
# 얼굴 클로즈업 시트를 받아 인물을 다시 굽는다.
#
#   docs/refs/face-<slug>.png  (2×2 머리·어깨 클로즈업)
#     → public/refs/<slug>-face-{front,left,right,back}.png
#     → Meshy 멀티이미지 (전신 4 + 얼굴 4 = 8장)
#     → 리깅 → 착석 → PBR 복원 → 압축 → public/characters/<slug>.opt.glb
#
# 사용법: bash scripts/add-face.sh manager [secretary ...]
#         (인자 없으면 docs/refs/face-*.png 를 전부 처리)
#
set -u
cd "$(dirname "$0")/.."

slugs=("$@")
if [ ${#slugs[@]} -eq 0 ]; then
  slugs=()
  for f in docs/refs/face-*.png; do
    [ -e "$f" ] || continue
    b=$(basename "$f" .png); slugs+=("${b#face-}")
  done
fi
[ ${#slugs[@]} -eq 0 ] && { echo "처리할 얼굴 시트가 없다 (docs/refs/face-<이름>.png)"; exit 0; }

for slug in "${slugs[@]}"; do
  echo "══ $slug ══"
  sheet="docs/refs/face-${slug}.png"
  [ -f "$sheet" ] || { echo "  ✗ $sheet 없음"; continue; }

  # 얼굴 시트를 쪼갠다. 배경 잘라내기(trim)를 켜서 얼굴이 프레임을 채우게 한다.
  python3 scripts/split_sheet.py "$sheet" "${slug}-face" --grid 2x2 \
    --out public/refs --count 4 || { echo "  ✗ 분할 실패"; continue; }
  # 2×2 격자는 0,1,2,3 번호로 나온다 → 시점 이름으로 바꾼다
  for pair in "0:front" "1:left" "2:right" "3:back"; do
    n="${pair%%:*}"; v="${pair##*:}"
    [ -f "public/refs/${slug}-face${n}.png" ] && \
      mv "public/refs/${slug}-face${n}.png" "public/refs/${slug}-face-${v}.png"
  done

  n=$(ls public/refs/${slug}-face-*.png 2>/dev/null | wc -l | tr -d ' ')
  echo "  얼굴 시점 ${n}/4"
  [ "$n" = "4" ] || { echo "  ✗ 얼굴 분할이 4장이 아니다"; continue; }

  # 옛 산출물을 치워야 재생성된다
  rm -f "assets-src/${slug}.mvrigged.glb" "assets-src/${slug}.mv.glb" \
        "assets-src/${slug}.mvseated.glb" "assets-src/${slug}.pbr.glb"

  bash scripts/build-chars.sh "$slug" || echo "  ✗ 빌드 실패"
done
echo "══ 완료 ══"
