# 配信時ダウンスケール支援（server/downscale.py）の検証（2026-10-31）
import io
import os
import sys
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "server"))

import downscale  # noqa: E402

# pytest の tmp_path はサンドボックス環境で書けないため、workspace 内 .tmp を使う
TMP = os.path.join(ROOT, ".tmp", "downscale_tests")


def _make_png(rgba: bool = False) -> str:
    os.makedirs(TMP, exist_ok=True)
    p = os.path.join(TMP, f"img_{uuid.uuid4().hex}.png")
    if rgba:
        im = Image.new("RGBA", (300, 120), (200, 30, 30, 128))
    else:
        im = Image.new("RGB", (300, 120), (200, 30, 30))
    im.save(p)
    return p


def test_probe_size():
    os.makedirs(TMP, exist_ok=True)
    p = _make_png()
    try:
        assert downscale.probe_size(p) == (300, 120)
        assert downscale.probe_size(os.path.join(TMP, "nope.png")) is None
    finally:
        os.remove(p)


def test_render_downscaled_long_side_cap():
    p = _make_png()
    try:
        data = downscale.render_downscaled(p, 150, 85)
        im = Image.open(io.BytesIO(data))
        assert im.format == "JPEG"
        assert im.size == (150, 60)  # 長辺 150 に等倍縮小
    finally:
        os.remove(p)


def test_render_downscaled_rgba_composited():
    # RGBA は JPEG に書けないため白背景合成で RGB 化されていること
    p = _make_png(rgba=True)
    try:
        data = downscale.render_downscaled(p, 150, 85)
        im = Image.open(io.BytesIO(data))
        assert im.format == "JPEG"
        assert im.mode == "RGB"
    finally:
        os.remove(p)


def test_cache_path_stable_and_invalidates():
    p = _make_png()
    try:
        a = downscale.cache_path_for(p, "a.png", TMP, 2560, 85)
        b = downscale.cache_path_for(p, "a.png", TMP, 2560, 85)
        assert a == b and a.endswith(".jpg")
        c = downscale.cache_path_for(p, "a.png", TMP, 2000, 85)
        assert c != a  # 変換パラメータ違いは別キャッシュ
        os.utime(p, ns=(1000000000, 1000000000))
        d = downscale.cache_path_for(p, "a.png", TMP, 2560, 85)
        assert d != a  # 原画の mtime 変化で別キャッシュ（旧キャッシュは自然に未参照）
    finally:
        os.remove(p)
