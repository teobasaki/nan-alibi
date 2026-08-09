"""
노드가 잘게 쪼개진 GLB 를 **재질 단위로 합친다** (Blender 헤드리스).

## 왜 필요한가
받은 경찰서 에셋은 노드 2,889개 · 메시 1,470개인데 재질은 **21종뿐**이다.
Three.js 는 오브젝트마다 드로우콜을 내므로, 합치지 않으면 프레임마다 1,470번을
그린다. 재질이 21종이라는 것은 **이론상 21번이면 된다**는 뜻이다.

## 왜 "재질별로 나눠 합치기" 가 아니라 "전부 하나로" 인가
전부 한 메시로 합쳐도 **재질 슬롯은 면 단위로 보존된다.** 렌더러는 그 슬롯 경계로
자동 배칭하므로 결과는 같고, 스크립트는 훨씬 단순해진다.
오브젝트를 재질별로 갈라 합치려면 다중 재질 오브젝트를 먼저 쪼개야 하는데,
그 과정에서 UV·법선이 상하는 경우가 있다.

## 잃는 것 — 정직하게
합치면 **개별 오브젝트를 이름으로 집을 수 없다.** 소품 하나만 숨기거나 클릭하는 일은
불가능해진다. 이 에셋에서 필요한 것은 "걸어 다닐 공간" 이지 "소품 상호작용" 이 아니므로
그 대가를 치른다. 상호작용은 우리가 코드로 놓는 마커가 담당한다.

**다만 천장·윗벽은 남겨야 한다** — 위에서 내려다보는 화면이려면 그것들을 숨겨야 하고,
합쳐버리면 숨길 수가 없다. 그래서 높이로 먼저 갈라 두 덩어리로 만든다.

사용:
  blender -b --python scripts/merge_by_material.py -- <in.glb> <out.glb> [천장높이m]
"""

import bpy
import sys


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def join(objs, name):
    """여러 메시를 하나로. 재질 슬롯은 면 단위로 보존된다."""
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    return merged


def main() -> int:
    args = argv()
    if len(args) < 2:
        print('사용: <in.glb> <out.glb> [천장높이m]')
        return 1
    src, dst = args[0], args[1]
    # 이 높이 위쪽은 '천장' 으로 따로 뺀다. 탑다운 카메라에서 숨기기 위해서다.
    ceiling = float(args[2]) if len(args) > 2 else 2.6

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    before_objs = len(mesh_objects())
    before_mats = len(bpy.data.materials)

    # 변환을 구워야 합칠 때 위치가 안 흐트러진다 (좌표계 통일 — 이 프로젝트가
    # 3D 에서 반복해 밟은 함정이다. matrix_world 와 로컬이 섞이면 배치가 틀어진다)
    bpy.ops.object.select_all(action='DESELECT')
    for o in mesh_objects():
        o.select_set(True)
    if mesh_objects():
        bpy.context.view_layer.objects.active = mesh_objects()[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 높이로 가른다 — 오브젝트의 **아랫면**이 천장선 위에 있으면 천장 쪽이다
    upper, lower = [], []
    for o in mesh_objects():
        zs = [(o.matrix_world @ v.co).z for v in o.data.vertices[:64]] or [0]
        (upper if min(zs) >= ceiling else lower).append(o)

    print(f'MERGE|입력 메시 {before_objs} · 재질 {before_mats}')
    print(f'MERGE|천장선 {ceiling}m 기준 — 아래 {len(lower)} · 위 {len(upper)}')

    a = join(lower, 'Station')
    b = join(upper, 'Ceiling')

    after = [x for x in (a, b) if x]
    slots = sum(len(x.data.materials) for x in after)
    tris = sum(len(x.data.polygons) for x in after)
    print(f'MERGE|출력 오브젝트 {len(after)} · 재질 슬롯 합 {slots} · 면 {tris}')

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_animations=False,   # 이 에셋에는 애니메이션이 없다
        export_apply=True,
    )
    print(f'MERGE|저장 {dst}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
