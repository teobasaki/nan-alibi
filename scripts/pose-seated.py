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
    # 어깨만 고정. **팔은 모델마다 탐색한다** — 아래 fit_arms() 참조.
    'LeftShoulder':  (0, 0, 4),
    'RightShoulder': (0, 0, -4),
}


def fit_arms(arm, side):
    """
    손이 무릎 위에 오도록 위팔·아래팔 각도를 **탐색으로** 찾는다.

    각도를 상수로 박았다가 틀렸다: 그 값은 A포즈 레스트를 기준으로 한 상대값인데,
    이미지→3D 로 만든 모델은 **T포즈 레스트**라 같은 값을 넣으면 팔이 벌어진 채 남는다.
    포즈 회전은 언제나 레스트 포즈로부터의 델타이므로, 레스트가 바뀌면 값도 바뀐다.

    그래서 각 모델에서 직접 잰다. 거친 격자 → 주변 정밀 탐색, 몇 초면 끝난다.
    """
    import itertools
    pb = arm.pose.bones
    upper, fore = pb[f'{side}Arm'], pb[f'{side}ForeArm']
    upper.rotation_mode = fore.rotation_mode = 'XYZ'

    def hand():
        bpy.context.view_layer.update()
        return arm.matrix_world @ pb[f'{side}Hand'].head

    bpy.context.view_layer.update()
    knee = (arm.matrix_world @ pb[f'{side}Leg'].head).copy()
    target = knee.copy()
    target.z += 0.06

    best = None
    for ux, uy, uz in itertools.product(range(-90, 51, 20), range(-80, 81, 40), range(-60, 81, 20)):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(-110, 111, 25), range(-110, 111, 25)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            d = (hand() - target).length
            if best is None or d < best[0]:
                best = (d, (ux, uy, uz), (fx, fz))

    (bu, bf) = best[1], best[2]
    for ux, uy, uz in itertools.product(*[range(v - 15, v + 16, 5) for v in bu]):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(bf[0] - 15, bf[0] + 16, 5), range(bf[1] - 15, bf[1] + 16, 5)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            d = (hand() - target).length
            if d < best[0]:
                best = (d, (ux, uy, uz), (fx, fz))

    upper.rotation_euler = Euler((R(best[1][0]), R(best[1][1]), R(best[1][2])), 'XYZ')
    fore.rotation_euler = Euler((R(best[2][0]), 0, R(best[2][1])), 'XYZ')
    hand_b = pb.get(f'{side}Hand')
    if hand_b:
        hand_b.rotation_mode = 'XYZ'
        hand_b.rotation_euler = Euler((R(-15), 0, 0), 'XYZ')
    print(f'  {side} 팔: 손↔무릎 {best[0]:.3f}m · 위팔{best[1]} 아래팔{best[2]}')


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

    for side in ('Left', 'Right'):
        fit_arms(arm, side)

    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()

    # 발을 바닥에 붙인다 — 실제 최저점을 재서 내린다. 모델마다 크기가 달라 눈대중은 틀린다.
    body = max(meshes, key=lambda m: len(m.data.vertices))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    lo = min((body.matrix_world @ v.co).z for v in ev.data.vertices)
    arm.location.z -= lo
    bpy.context.view_layer.update()

    # **포즈를 레스트로 굳히지 않는다.**
    # `pose.armature_apply()` 를 쓰면 아마추어의 레스트는 바뀌지만 스킨 메시의 바인드가
    # 따라오지 않아 익스포트 결과가 원래 포즈로 되돌아간다 (실측: 폭 1.55m = 팔 벌린 T포즈).
    # glTF 는 관절 노드의 TRS 를 그대로 싣기 때문에, **포즈를 켠 채 내보내면** 된다.

    # 본체 메시와 아마추어만. Meshy 출력에 딸려오는 잡동사니는 제외한다.
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm

    # **`export_rest_position_armature` 가 기본 True 다** — 그대로 두면 포즈를 무시하고
    # 레스트 포즈(T/A포즈)를 내보낸다. 이걸 못 찾아서 두 번 헛돌았다:
    # `pose.armature_apply()` 로 레스트를 바꿔 봤지만 스킨 바인드가 따라오지 않아 소용없었다.
    # 정답은 굳히는 게 아니라 **현재 포즈를 그대로 싣는 것**이다.
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', use_selection=True,
        export_apply=False, export_animations=False, export_skins=True,
        export_rest_position_armature=False,
        export_current_frame=True,
        export_reset_pose_bones=False,
    )
    print(f'  앉힘: {dst}')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    if len(argv) != 2:
        raise SystemExit('사용법: -- <입력.glb> <출력.glb>')
    main(argv[0], argv[1])
