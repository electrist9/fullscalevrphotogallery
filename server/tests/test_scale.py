# M2 原寸大の数学と虹彩パイプラインの検証（PLAN.md §4.4 / §9: 誤差<5%）
import math
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "server"))

import scale  # noqa: E402

PHOTOS = os.path.join(ROOT, "Photos")


# ---------- 純粋関数（§4.2 の数式） ----------

def test_ipd_math():
    # 126px / 63mm → 0.5 mm/px（キャリブ合成画像の真値）
    assert scale.mm_per_px(126.0) == pytest.approx(0.5)
    assert scale.mm_per_px(189.0) == pytest.approx(1 / 3)
    # IPD設定で上書き
    assert scale.mm_per_px(126.0, ipd_mm=70.0) == pytest.approx(70.0 / 126.0)


def test_yaw_correction():
    # yaw 60°: 見かけ100px → 補正200px → mm/px は半分
    assert scale.mm_per_px(100.0, yaw_deg=60.0) == pytest.approx(63.0 / 200.0)
    # yaw 0 と微小はほぼ同一（|θ|≤20° は誤差≤6%）
    assert scale.mm_per_px(100.0, yaw_deg=10.0) == pytest.approx(63.0 / (100.0 / math.cos(math.radians(10))))
    # |yaw|>60° は低信頼 → None（フォールバック）
    assert scale.mm_per_px(100.0, yaw_deg=75.0) is None
    assert scale.mm_per_px(None) is None
    assert scale.mm_per_px(0.0) is None


def test_clamp():
    # 幅12000px × 0.5mm/px = 6m → 最大辺3.0mへクランプ
    mmpp, clamped = scale.clamp_mm_per_px(12000, 4000, 0.5)
    assert clamped
    w, h = scale.plane_size_m(12000, 4000, mmpp)
    assert w == pytest.approx(3.0)
    # 極小は0.3mへ引き上げ
    mmpp, clamped = scale.clamp_mm_per_px(100, 80, 0.1)
    assert clamped
    w, h = scale.plane_size_m(100, 80, mmpp)
    assert w == pytest.approx(0.3)
    # 正常範囲はノータッチ
    mmpp, clamped = scale.clamp_mm_per_px(1000, 1704, 0.932)
    assert not clamped and mmpp == 0.932


def test_height_mm():
    # 身長 = 頭頂→足元 (px) × mm/px。1700px × 1.0mm/px = 1700mm
    assert scale.height_mm(100.0, 1800.0, 1.0) == pytest.approx(1700.0)
    # 0.5mm/px なら半分
    assert scale.height_mm(100.0, 1800.0, 0.5) == pytest.approx(850.0)
    # 入力欠損・足元が頭頂より上（異常）は None
    assert scale.height_mm(None, 1800.0, 1.0) is None
    assert scale.height_mm(100.0, None, 1.0) is None
    assert scale.height_mm(100.0, 1800.0, None) is None
    assert scale.height_mm(1800.0, 100.0, 1.0) is None
    assert scale.height_mm(100.0, 100.0, 1.0) is None


# ---------- 虹彩パイプライン実測（実在顔） ----------
# 注: Photos/calibration_* は合成ターゲットで、MediaPipe は卡通顔の虹彩を正しく計測できない
# （README 記載どおり pupil_px 手動入力経路用）。よって検出精度テストは実在顔写真で行う。
# §9 の「キャリブレーション人物基準 ±5%」は実写キャリブ（既知IPDの人物）での実機検証で確認する。

def _detect_main(path):
    from PIL import Image
    import facedetect
    with Image.open(path) as im:
        faces = facedetect.detect_faces(im)
    assert faces, f"顔検出0件: {path}"
    return max(faces, key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]))


def test_usersample_regression():
    """実在顔の pupil_px 退行ガード（2026-10-24 実測値 ±2%）と mm/px 計算の一致。"""
    expected = {
        "usersample1.png": (67.6, "top50"),
        "usersample2.png": (43.3, "full"),
        "usersample3.png": (61.2, "full"),
        "usersample4.png": (86.9, "full"),
    }
    for fname, (ppx, method) in expected.items():
        f = _detect_main(os.path.join(PHOTOS, fname))
        assert f["method"] == method, f"{fname}: method={f['method']}"
        assert abs(f["pupil_px"] - ppx) / ppx < 0.02, f"{fname}: pupil_px={f['pupil_px']:.1f} (期待{ppx})"
        # 原寸配置に使う虹彩中心が画像内に存在すること
        assert 0 <= f["eye_cx"] <= 4000 and 0 <= f["eye_cy"] <= 4000
        # yaw補正後の mm/px が 63/pupil_px とほぼ一致（正面写真なので yaw は小さい）
        assert abs(f["yaw_deg"]) < 30.0, f"{fname}: yaw={f['yaw_deg']:.1f}"
        mmpp = scale.mm_per_px(f["pupil_px"], f["yaw_deg"])
        assert mmpp == pytest.approx(63.0 / f["pupil_px"], rel=0.06)
