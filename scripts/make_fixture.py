# 検証用キャリブレーション画像の生成
# 実行: python scripts/make_fixture.py
# 出力: Photos/calibration_face_ipd126px.png, calibration_face_ipd189px.png, calibration_a4.png
#
# 設計思想: 「虹彩中心間距離(px)」と「実寸mm」を既知にしておく。
# アプリの原寸大モードで表示し、VR内で物理定規を当てて検証できる。
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Photos")
os.makedirs(OUT, exist_ok=True)

IPD_REAL_MM = 63.0


def font(size):
    for name in ("arial.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_face(path, pupil_px, head_w_px):
    """正面顔ターゲット。虹彩中心間距離 = pupil_px px (厳密)。"""
    W, H = 1600, 1200
    mm_per_px = IPD_REAL_MM / pupil_px
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_big, f_mid, f_small = font(30), font(24), font(18)

    cx, cy = W // 2, 560
    head_h = int(head_w_px * 1.28)
    skin = (232, 195, 158)
    # 頭部 (実寸 head_w_px * mm_per_px mm の横幅になる)
    d.ellipse([cx - head_w_px // 2, cy - head_h // 2,
               cx + head_w_px // 2, cy + head_h // 2],
              fill=skin, outline="black", width=3)
    # 耳 (頭部の両端に接する)
    for sx in (-1, 1):
        ex = cx + sx * head_w_px // 2
        d.ellipse([ex - 18, cy - 40, ex + 18, cy + 40], fill=skin, outline="black", width=2)
    # 目: 虹彩中心は cx ± pupil_px/2 に厳密に配置
    eye_y = cy - int(head_h * 0.13)
    half = pupil_px / 2.0
    for sx in (-1, 1):
        ix = cx + sx * half
        d.ellipse([ix - 34, eye_y - 34, ix + 34, eye_y + 34],
                  fill="white", outline="black", width=2)          # 強膜
        d.ellipse([ix - 16, eye_y - 16, ix + 16, eye_y + 16],
                  fill=(110, 70, 40), outline="black", width=1)    # 虹彩
        d.ellipse([ix - 7, eye_y - 7, ix + 7, eye_y + 7], fill="black")  # 瞳孔
        # 虹彩中心の十字マーク (計測位置の目視確認用)
        d.line([ix - 24, eye_y, ix + 24, eye_y], fill="red", width=1)
        d.line([ix, eye_y - 24, ix, eye_y + 24], fill="red", width=1)
    # 虹彩中心間の寸法線
    dim_y = eye_y - 60
    d.line([cx - half, dim_y, cx + half, dim_y], fill="red", width=2)
    for sx in (-1, 1):
        d.line([cx + sx * half, dim_y - 8, cx + sx * half, dim_y + 8], fill="red", width=2)
    # 鼻・口 (形状のみ)
    d.polygon([(cx, cy + 30), (cx - 22, cy + 78), (cx + 22, cy + 78)], outline="black")
    d.arc([cx - 60, cy + 80, cx + 60, cy + 140], 20, 160, fill="black", width=3)

    # 定規: 目盛り = 10mm (20px * mm_per_px で調整)
    tick_px = 10.0 / mm_per_px
    y0 = 1060
    d.line([100, y0, 1500, y0], fill="black", width=2)
    x = 100.0
    mm = 0
    while x <= 1500:
        big = (mm % 50 == 0)
        d.line([x, y0, x, y0 - (18 if big else 9)], fill="black", width=2)
        if big:
            d.text((x - 12, y0 + 6), f"{mm}", font=f_small, fill="black")
        x += tick_px
        mm += 10
    d.text((100, y0 - 40), "ruler: 1 division = 10 mm (at life-size)", font=f_small, fill="black")

    # ヘッダ注記
    head_mm = head_w_px * mm_per_px
    d.text((60, 30), f"SYNTHETIC face target - iris centers = {pupil_px} px apart (red crosshairs)",
           font=f_big, fill="black")
    d.text((60, 75), f"IPD {IPD_REAL_MM:.0f} mm -> {mm_per_px:.4f} mm/px -> head width {head_w_px} px = {head_mm:.0f} mm at life-size",
           font=f_mid, fill=(0, 90, 180))
    img.save(path)
    print(f"saved {path}  (pupil_px={pupil_px}, mm/px={mm_per_px:.4f}, head={head_mm:.0f}mm)")


def draw_a4(path):
    """A4サイズ基準: 原寸大表示時に実物のA4用紙と一致するはず。"""
    mm_per_px = IPD_REAL_MM / 126.0  # 126pxターゲットと同じ 0.5 mm/px
    w = int(210 / mm_per_px)   # 420 px
    h = int(297 / mm_per_px)   # 594 px
    W, H = 800, 1000
    img = Image.new("RGB", (W, H), (240, 240, 240))
    d = ImageDraw.Draw(img)
    x0, y0 = (W - w) // 2, (H - h) // 2 - 40
    d.rectangle([x0, y0, x0 + w, y0 + h], fill="white", outline="black", width=3)
    d.text((x0, y0 - 60), "A4 portrait target: rectangle = 210 x 297 mm", font=font(28), fill="black")
    d.text((x0, y0 - 25), f"at 0.5 mm/px this is {w} x {h} px", font=font(20), fill=(0, 90, 180))
    # 対角線と中心マーク
    d.line([x0, y0, x0 + w, y0 + h], fill=(200, 0, 0), width=1)
    d.line([x0 + w, y0, x0, y0 + h], fill=(200, 0, 0), width=1)
    d.text((x0 + 10, y0 + h + 10), "life-size check: overlay a real A4 sheet", font=font(18), fill="black")
    img.save(path)
    print(f"saved {path}  (A4 = {w}x{h} px at 0.5 mm/px)")


draw_face(os.path.join(OUT, "calibration_face_ipd126px.png"), pupil_px=126, head_w_px=360)
draw_face(os.path.join(OUT, "calibration_face_ipd189px.png"), pupil_px=189, head_w_px=540)
draw_a4(os.path.join(OUT, "calibration_a4.png"))
