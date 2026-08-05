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

    # 몸통 축 — 팔이 이걸 뚫고 지나가면 안 된다
    spine_lo = arm.matrix_world @ pb['Spine'].head
    spine_hi = arm.matrix_world @ pb['Spine02'].tail
    shoulder_w = abs((arm.matrix_world @ pb[f'{side}Shoulder'].head).x - spine_lo.x)
    CLEAR = max(0.10, shoulder_w * 0.9)   # 몸통 반지름 어림

    def torso_hit():
        """팔꿈치와 손이 몸통 축에 얼마나 파고들었는지. 0 이면 안 겹친다."""
        pen = 0.0
        for p in (pb[f'{side}ForeArm'].head, pb[f'{side}Hand'].head, pb[f'{side}Hand'].tail):
            w = arm.matrix_world @ p
            # 몸통 축(수직선)까지의 수평 거리
            t = max(0.0, min(1.0, (w.z - spine_lo.z) / max(1e-6, spine_hi.z - spine_lo.z)))
            axis = spine_lo.lerp(spine_hi, t)
            horiz = ((w.x - axis.x) ** 2 + (w.y - axis.y) ** 2) ** 0.5
            if horiz < CLEAR:
                pen += (CLEAR - horiz)
        return pen

    def cost():
        """
        손을 무릎에 놓되 **몸통을 뚫지 않는다.**
        거리만 최소화했더니 팔이 가슴을 통과한 채로 손만 무릎에 닿는 답이 나왔다 —
        관통 벌점이 없으면 탐색은 언제나 그 지름길을 고른다.
        """
        bpy.context.view_layer.update()
        return (hand() - target).length + torso_hit() * 3.0

    best = None
    for ux, uy, uz in itertools.product(range(-90, 51, 20), range(-80, 81, 40), range(-60, 81, 20)):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(-110, 111, 25), range(-110, 111, 25)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if best is None or c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))

    (bu, bf) = best[1], best[2]
    for ux, uy, uz in itertools.product(*[range(v - 15, v + 16, 5) for v in bu]):
        upper.rotation_euler = Euler((R(ux), R(uy), R(uz)), 'XYZ')
        for fx, fz in itertools.product(range(bf[0] - 15, bf[0] + 16, 5), range(bf[1] - 15, bf[1] + 16, 5)):
            fore.rotation_euler = Euler((R(fx), 0, R(fz)), 'XYZ')
            c = cost()
            if c < best[0]:
                best = (c, (ux, uy, uz), (fx, fz))

    upper.rotation_euler = Euler((R(best[1][0]), R(best[1][1]), R(best[1][2])), 'XYZ')
    fore.rotation_euler = Euler((R(best[2][0]), 0, R(best[2][1])), 'XYZ')
    hand_b = pb.get(f'{side}Hand')
    if hand_b:
        hand_b.rotation_mode = 'XYZ'
        hand_b.rotation_euler = Euler((R(-15), 0, 0), 'XYZ')
    bpy.context.view_layer.update()
    print(f'  {side} 팔: 비용 {best[0]:.3f} (손↔무릎 {(hand() - target).length:.3f}m · '
          f'몸통관통 {torso_hit():.3f}) · 위팔{best[1]} 아래팔{best[2]}')


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

    body = max(meshes, key=lambda m: len(m.data.vertices))

    """
    **엉덩이를 의자 좌면에 맞춘다.**
    발바닥을 바닥(0)에 맞췄더니 엉덩이 높이가 모델마다 달라 의자와 겹쳤다.
    앉은 사람의 기준은 발이 아니라 **엉덩이가 닿는 면**이다.
    방 에셋의 좌면은 원본 z≈-0.36, 배율 1.9 기준 바닥에서 0.455m 다.
    """
    SEAT_H = 0.455
    hips_z = (arm.matrix_world @ arm.pose.bones['Hips'].head).z
    arm.location.z += SEAT_H - hips_z
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
