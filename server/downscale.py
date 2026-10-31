# 配信時ダウンスケール支援（2026-10-31）: 原画の長辺が上限超過なら JPEG 化してキャッシュ配信。
# 背景: VR 詳細表示は原画をそのままテクスチャ化するため、Upscayl 生成物（3200x7200 級）は
# Quest 3 の GPU メモリ（RGBA 約92MB）と転送・デコード時間で過剰。長辺 2560px（config.py
# DOWNSCALE_MAX_PX）に収める実測コストは約0.3秒（.tmp/downscale_bench.py）で、
# 転送・クライアントデコード削減（16.3MB→214KB）で相殺できる。
import hashlib
import io
import os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # Upscayl 生成物等大きい画像を許容（DecompressionBomb 警告対象外）

# ダウンスケール対象の拡張子。gif はアニメーション損失のため原画そのまま配信。
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def probe_size(path: str):
    """ヘッダのみ読んで (width, height)。読めない/画像でなければ None。"""
    try:
        with Image.open(path) as im:
            return im.size
    except (OSError, ValueError):
        return None


def cache_path_for(photo_path: str, rel: str, cache_dir: str, max_px: int, quality: int) -> str:
    """原画の relpath+mtime+size と変換パラメータからキャッシュファイルパスを導出。
    原画が差し替われば（mtime/size 変化）別ファイルになり、旧キャッシュは自然に未参照になる。"""
    st = os.stat(photo_path)
    key = f"{rel}|{st.st_mtime_ns}|{st.st_size}|{max_px}|{quality}"
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(cache_dir, h + ".jpg")


def render_downscaled(photo_path: str, max_px: int, quality: int) -> bytes:
    """原画を長辺 max_px に収め JPEG q<quality> のバイト列で返す。
    アルファ付き（RGBA/LA/P透明）は白背景合成（JPEG はアルファ不可。VR パネルは不透明なので問題なし）。
    失敗時は OSError/ValueError を上げる（呼び出し側で原画配信にフォールバック）。"""
    im = Image.open(photo_path)
    im.load()
    if im.mode == "P" and "transparency" in im.info:
        im = im.convert("RGBA")
    if "A" in im.getbands():
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.convert("RGBA").split()[-1])
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((max_px, max_px), Image.LANCZOS)  # 長辺基準で縮小（拡大はしない）
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()
