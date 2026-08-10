"""
GLB 에서 특정 덩어리를 떼어낸다 — **골든 케이스 §4(수단·유혈 묘사 금지) 준수용.**

## 왜 필요했나
Sketchfab 「Doctor's bag」(왕진 가방, `ev-autopsy`)에는 가방 말고도 **톱과 붉은 액체 약병**이
같이 모델링돼 있다. 이 게임의 정본은 수단·신체·유혈 묘사를 금지하는데, 그 소품이
「현장 판정」 증거로 사건 현장에 그대로 놓인다. 카메라 각도로는 못 가린다 —
톱이 가방 뒤에 세워진 별개 덩어리라 어느 방위각에서도 위로 삐져나온다.

머티리얼 단위로는 못 지운다. 이 GLB 는 머티리얼로 병합돼 있어서
`spike_lambert2_0` 하나에 **가방·프레임·톱·주사기가 전부** 들어 있다.
그래서 느슨한 덩어리(loose parts)로 쪼갠 뒤 부피 기준으로 고른다.

사용:
  blender -b --python scripts/strip-parts.py -- <in.glb> <out.glb> [--list]
  --list 만 주면 지우지 않고 덩어리 목록(치수·위치·부피)만 찍는다.
"""

import bpy
import sys


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def main():
    args = argv()
    if not args:
        print('사용: <in.glb> <out.glb> [--list] [--drop=i,j,k]')
        return 1
    src = args[0]
    out = args[1] if len(args) > 1 and not args[1].startswith('--') else None
    listing = '--list' in args
    drop = set()
    for a in args:
        if a.startswith('--drop='):
            drop = {int(x) for x in a[7:].split(',') if x.strip()}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(False)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.mesh.separate(type='LOOSE')

    parts = sorted(
        (o for o in bpy.data.objects if o.type == 'MESH'),
        key=lambda o: -(o.dimensions.x * o.dimensions.y * o.dimensions.z),
    )
    for i, o in enumerate(parts):
        d = o.dimensions
        c = o.matrix_world.translation
        vol = d.x * d.y * d.z
        print(f'PART|{i}|{o.name}|dim {d.x:.3f}×{d.y:.3f}×{d.z:.3f}|vol {vol:.4f}|'
              f'verts {len(o.data.vertices)}|z {c.z:.3f}')

    if listing or out is None:
        return 0

    for i, o in enumerate(parts):
        if i in drop:
            print(f'DROP|{i}|{o.name}')
            bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
    print('SAVED|' + out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
