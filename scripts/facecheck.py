# 顔検出・虹彩計測スモークテスト (MediaPipe Face Landmarker)
# 実行: python scripts/facecheck.py [画像パス...]  (省略時は Photos/ 内の jpg/png すべて)
import importlib.util
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if importlib.util.find_spec("mediapipe") is None:  # venv未導入時のみ .pylibs フォールバック
    sys.path.insert(0, os.path.join(ROOT, ".pylibs"))

from mediapipe.tasks import python as mpp  # noqa: E402
from mediapipe.tasks.python import vision  # noqa: E402
import mediapipe as mp  # noqa: E402

MODEL = os.path.join(ROOT, "models", "face_landmarker.task")
IPD_REAL_MM = 63.0
# 478点トポロジー (index 0〜477)。人物の右眼側=画像左: 中心468、人物の左眼側=画像右: 中心473
IRIS_CENTER_A = 468
IRIS_CENTER_B = 473


def detect_one(img):
    opts = vision.FaceLandmarkerOptions(
        base_options=mpp.BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=5,
        min_face_detection_confidence=0.3,
    )
    lm = vision.FaceLandmarker.create_from_options(opts)
    res = lm.detect(img)
    lm.close()
    return res


def report(res, W, H, label=""):
    n = len(res.face_landmarks)
    print(f"  {label}: {W}x{H} faces={n}")
    for i, f in enumerate(res.face_landmarks):
        if len(f) < 478:
            print(f"  face{i}: landmarks={len(f)} (<478, 虹彩なしモデル?)")
            continue
        A, B = f[IRIS_CENTER_A], f[IRIS_CENTER_B]
        ax, ay = A.x * W, A.y * H
        bx, by = B.x * W, B.y * H
        pupil_px = math.hypot(bx - ax, by - ay)
        theta = math.degrees(math.atan2(by - ay, bx - ax))
        mm_per_px = IPD_REAL_MM / pupil_px
        xs = [p.x * W for p in f]
        ys = [p.y * H for p in f]
        print(f"  face{i}: iris_A=({ax:.1f},{ay:.1f}) iris_B=({bx:.1f},{by:.1f})")
        print(f"    pupil_px={pupil_px:.1f}  iris_line_angle={theta:+.1f}deg  "
              f"mm/px={mm_per_px:.4f} (IPD {IPD_REAL_MM:.0f}mm想定)")
        print(f"    landmark bbox: x[{min(xs):.0f}..{max(xs):.0f}] y[{min(ys):.0f}..{max(ys):.0f}]")


def check(path):
    print(f"== {path}")
    img = mp.Image.create_from_file(path)
    W, H = img.width, img.height
    res = detect_one(img)
    report(res, W, H, "full")
    if not res.face_landmarks:
        # 全身写真など顔が小さい場合: 上部クロップ/拡大で再試行
        import numpy as np
        from PIL import Image as PILImage
        pil = PILImage.open(path).convert("RGB")
        tries = {
            "top50%": pil.crop((0, 0, W, H // 2)),
            "top30%": pil.crop((0, 0, W, int(H * 0.3))),
            "2x": pil.resize((W * 2, H * 2), PILImage.LANCZOS),
        }
        for name, sub in tries.items():
            arr = np.asarray(sub)
            sub_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=arr)
            r = detect_one(sub_img)
            report(r, sub.width, sub.height, name)
            if r.face_landmarks:
                break


def main():
    if len(sys.argv) > 1:
        paths = sys.argv[1:]
    else:
        d = os.path.join(ROOT, "Photos")
        paths = sorted(
            os.path.join(d, f) for f in os.listdir(d)
            if f.lower().endswith((".jpg", ".jpeg", ".png")) and not f.startswith("calibration")
        )
    for p in paths:
        check(p)


if __name__ == "__main__":
    main()
