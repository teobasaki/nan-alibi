"""
앉은 자세 적용 — 블렌더 헤드리스 배치.

Meshy 오토리깅은 **A포즈로 선 캐릭터**를 준다. 심문 장면에 서 있는 사람은 어색하다.
이 스크립트가 리깅된 GLB 를 받아 의자에 앉은 자세로 굳혀 다시 내보낸다.

왜 스크립트인가: MCP 로 대화하며 한 명씩 잡으면 재현이 안 된다. 모델을 다시 뽑거나
자세를 고칠 때마다 처음부터 다시 해야 한다. 8명에 같은 값을 적용하려면 파일이어야 한다.

왜 이 각도인가: 눈대중이 아니라 **탐색으로 찾았다.** 팔 각도는 위팔·아래팔 3축을
훑으면서 "손이 무릎 위에 오는" 조합을 거리 최소화로 골랐다 (왼손↔왼무릎 0.13m).
Meshy 리그는 24본 Mixamo 계열 이름이라 8명이 같은 값을 공유한다.

사용법:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/pose-seated.py -- <입력.glb> <출력.glb>
"""
import bpy
import math
import sys
from mathutils import Euler

R = math.radians

# 뼈 이름 → (x, y, z) 도 단위. Meshy 오토리깅의 24본 규격.
SEATED = {
    # 다리 — 허벅지 수평, 정강이 수직
    'LeftUpLeg':  (-88, 0, 4),
    'RightUpLeg': (-88, 0, -4),
    'LeftLeg':    (84, 0, 0),
    'RightLeg':   (84, 0, 0),
    'LeftFoot':   (8, 0, 0),
    'RightFoot':  (8, 0, 0),
    # 상체 — 취조받는 사람은 뒤로 기대지 않는다. 살짝 앞으로, 고개는 조금 숙인다.
    'Spine':   (6, 0, 0),
    'Spine01': (3, 0, 0),
    'Spine02': (2, 0, 0),
    'neck':    (-4, 0, 0),
    'Head':    (2, 0, 0),
    # 팔 — 손이 허벅지 위에 놓인다 (탐색으로 찾은 값)
    'LeftShoulder':  (0, 0, 4),
    'RightShoulder': (0, 0, -4),
    'LeftArm':       (-45, 60, 40),
    'RightArm':      (-45, -60, -40),
    'LeftForeArm':   (60, 0, -100),
    'RightForeArm':  (60, 0, 100),
    'LeftHand':      (-15, 0, 0),
    'RightHand':     (-15, 0, 0),
}


def main(src, dst):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=src)

    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not arms:
        raise SystemExit(f'아마추어가 없다: {src} — 리깅되지 않은 파일이다')
    arm = arms[0]

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    missing = []
    for name, (x, y, z) in SEATED.items():
        pb = arm.pose.bones.get(name)
        if not pb:
            missing.append(name)
            continue
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler((R(x), R(y), R(z)), 'XYZ')
    if missing:
        print(f'  ! 없는 뼈 {len(missing)}개: {missing[:6]}')

    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()

    # 발을 바닥에 붙인다 — 실제 최저점을 재서 내린다. 모델마다 크기가 달라 눈대중은 틀린다.
    body = max(meshes, key=lambda m: len(m.data.vertices))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    lo = min((body.matrix_world @ v.co).z for v in ev.data.vertices)
    arm.location.z -= lo
    bpy.context.view_layer.update()

    # 포즈를 레스트 포즈로 굳힌다. 안 하면 glTF 가 원래의 A포즈를 내보낸다.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # 본체 메시와 아마추어만. Meshy 출력에 딸려오는 잡동사니는 제외한다.
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', use_selection=True,
        export_apply=False, export_animations=False, export_skins=True,
    )
    print(f'  앉힘: {dst}')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    if len(argv) != 2:
        raise SystemExit('사용법: -- <입력.glb> <출력.glb>')
    main(argv[0], argv[1])
