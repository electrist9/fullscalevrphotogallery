# MediaPipe Face Landmarker ラッパ（顔→虹彩→pupil_px）+ Pose Landmarker（足元y）
# 多段戦略: フル画像→0件なら上部50%/30%クロップ→2x拡大 (2026-10-24 実測で有効確認)
# 2026-10-26: 頭頂推定（crown_y）と Pose 足元検出（detect_sole）追加。身長=頭頂→足元。
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.path.join(ROOT, "models", "face_landmarker.task")
POSE_MODEL = os.path.join(ROOT, "models", "pose_landmarker_full.task")
IPD_DEFAULT_MM = 63.0
IRIS_CENTER_A = 468  # 人物の右眼側（画像左）中心
IRIS_CENTER_B = 473  # 人物の左眼側（画像右）中心
FACE_OVAL_TOP = 10   # 楕円輪郭の頭側（生え際付近）。頭頂推定の基準
CHIN_CENTER = 152    # 顎中心。輪郭高さの下端
CROWN_FACTOR = 0.25  # 頭頂 ≈ 輪郭上端 + 輪郭高さ×0.25（人体計測の平均値）
# BlazePose 足系ランドマーク（身長=頭頂→足元、足先接地に使用）
FOOT_LMS = (27, 28, 29, 30, 31, 32)  # 左右足首/踵/足先
FOOT_VIS_MIN = 0.5

_lm = None
_pl = None


def _landmarker():
    global _lm
    if _lm is None:
        import importlib.util
        if importlib.util.find_spec("mediapipe") is None:  # venv未導入時のみ .pylibs フォールバック
            import sys
            sys.path.insert(0, os.path.join(ROOT, ".pylibs"))
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision
        opts = vision.FaceLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=MODEL),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=5,
            min_face_detection_confidence=0.3,
        )
        _lm = vision.FaceLandmarker.create_from_options(opts)
    return _lm


def _detect_numpy(arr):
    import numpy as np
    import mediapipe as mp
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(arr))
    return _landmarker().detect(img)


def _to_rgb(pil_image):
    """RGBA等は白背景合成。mediapipe 入力用 RGB PIL Image を返す。"""
    from PIL import Image as PILImage

    if pil_image.mode != "RGB":
        base = PILImage.new("RGB", pil_image.size, (255, 255, 255))
        base.paste(pil_image, mask=pil_image.split()[-1] if pil_image.mode == "RGBA" else None)
        pil_image = base
    return pil_image


def _mp_image(arr):
    import mediapipe as mp
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=__import__("numpy").ascontiguousarray(arr))


def _pose_landmarker():
    global _pl
    if _pl is None:
        import importlib.util
        if importlib.util.find_spec("mediapipe") is None:
            import sys
            sys.path.insert(0, os.path.join(ROOT, ".pylibs"))
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision
        opts = vision.PoseLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=POSE_MODEL),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.3,
        )
        _pl = vision.PoseLandmarker.create_from_options(opts)
    return _pl


def detect_pose(pil_image):
    """フル画像 → Pose情報 dict または None。
    sole_y: 画像内で可視(vis>=0.5)な足系landmark(踵/足先/足首)の最大y。未検出は None。
    hip_cy/nose: 主顔との対応・解剖学比率チェックに使用（lm23/24, lm0）。"""
    if not os.path.isfile(POSE_MODEL):
        return None
    rgb = _to_rgb(pil_image)
    W, H = rgb.size
    res = _pose_landmarker().detect(_mp_image(__import__("numpy").asarray(rgb)))
    if not res.pose_landmarks:
        return None
    lms = res.pose_landmarks[0]
    ys = []
    for i in FOOT_LMS:
        if i < len(lms):
            lm = lms[i]
            v = getattr(lm, "visibility", None)
            x, y = lm.x * W, lm.y * H
            if (v is None or v >= FOOT_VIS_MIN) and 0.0 <= x <= W and 0.0 <= y <= H:
                ys.append(y)
    hips = [lms[i].y * H for i in (23, 24) if i < len(lms)]
    nose = (lms[0].x * W, lms[0].y * H) if lms else (None, None)
    return {
        "sole_y": max(ys) if ys else None,
        "hip_cy": sum(hips) / len(hips) if hips else None,
        "nose_x": nose[0],
        "nose_y": nose[1],
    }


def _conf(bbox, yaw_deg):
    """信頼度スコア（0〜1）: 顔サイズとyawから。|yaw|>60° は横顔として大きく減点。"""
    face_w = bbox[2] - bbox[0]
    c = min(1.0, face_w / 100.0)
    if yaw_deg is not None and abs(yaw_deg) > 60:
        c *= 0.3
    return round(c, 3)


def _measure(face, W, H):
    if len(face) < 478:
        return None
    a, b = face[IRIS_CENTER_A], face[IRIS_CENTER_B]
    ax, ay = a.x * W, a.y * H
    bx, by = b.x * W, b.y * H
    pupil_px = math.hypot(bx - ax, by - ay)
    roll_deg = math.degrees(math.atan2(by - ay, bx - ax))
    # yaw推定（§4.2姿勢補正用）: 虹彩中心の水平距離と奥行き差。正規化landmarkのzはxと同スケール。
    dxn, dzn = b.x - a.x, b.z - a.z
    yaw_deg = math.degrees(math.atan2(dzn, dxn)) if (abs(dxn) > 1e-9 or abs(dzn) > 1e-9) else 0.0
    xs = [p.x * W for p in face]
    ys = [p.y * H for p in face]
    bbox = [min(xs), min(ys), max(xs), max(ys)]
    # 頭頂推定: 楕円輪郭上端（生え際付近）から顎までの高さに対し人体計測分だけ上
    oval_top_y = face[FACE_OVAL_TOP].y * H
    chin_y = face[CHIN_CENTER].y * H
    crown_y = oval_top_y - max(0.0, chin_y - oval_top_y) * CROWN_FACTOR
    return {
        "bbox": bbox,
        "pupil_px": pupil_px,
        "roll_deg": roll_deg,
        "yaw_deg": yaw_deg,
        "eye_cx": (ax + bx) / 2,  # 虹彩中心の中点（原寸大の目の高さ配置に使用）
        "eye_cy": (ay + by) / 2,
        "crown_y": crown_y,      # 頭頂推定 y (px)。身長=頭頂→足元に使用
        "conf": _conf(bbox, yaw_deg),
    }


def detect_faces(pil_image):
    """PIL Image → 顔リスト [{bbox, pupil_px, roll_deg, method}]。RGBAは白背景合成。"""
    from PIL import Image as PILImage

    if pil_image.mode != "RGB":
        base = PILImage.new("RGB", pil_image.size, (255, 255, 255))
        base.paste(pil_image, mask=pil_image.split()[-1] if pil_image.mode == "RGBA" else None)
        pil_image = base

    W, H = pil_image.size
    res = _detect_numpy(__import__("numpy").asarray(pil_image))
    faces = [m for m in (_measure(f, W, H) for f in res.face_landmarks) if m]
    if faces:
        for f in faces:
            f["method"] = "full"
        return faces

    for name, crop in (("top50", (0, 0, W, H // 2)), ("top30", (0, 0, W, int(H * 0.3)))):
        sub = pil_image.crop(crop)
        res = _detect_numpy(__import__("numpy").asarray(sub))
        faces = [m for m in (_measure(f, sub.width, sub.height) for f in res.face_landmarks) if m]
        if faces:
            for f in faces:
                f["method"] = name
            return faces

    big = pil_image.resize((W * 2, H * 2), PILImage.LANCZOS)
    res = _detect_numpy(__import__("numpy").asarray(big))
    faces = [m for m in (_measure(f, big.width, big.height) for f in res.face_landmarks) if m]
    for f in faces:
        f["bbox"] = [v / 2 for v in f["bbox"]]
        f["pupil_px"] = f["pupil_px"] / 2
        f["eye_cx"] = f["eye_cx"] / 2
        f["eye_cy"] = f["eye_cy"] / 2
        f["crown_y"] = f["crown_y"] / 2
        f["conf"] = _conf(f["bbox"], f["yaw_deg"])  # 実寸pxで信頼度を再計算
        f["method"] = "2x"
    return faces


def mm_per_px(pupil_px, ipd_mm=IPD_DEFAULT_MM):
    return ipd_mm / pupil_px
