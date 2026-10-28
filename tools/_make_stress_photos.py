# 1000枚規模の快適性検証用: Photos/_stress/ に顔なしの合成写真（320×240 JPEG）を生成する。
# 使い方: .venv\Scripts\python.exe tools\_make_stress_photos.py [枚数]
# 削除: Photos\_stress フォルダごと削除 → 2Dページの「再スキャン」で一覧から消える。
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from PIL import Image as PILImage

OUT = os.path.join(ROOT, "Photos", "_stress")
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000

rng = random.Random(20261026)
os.makedirs(OUT, exist_ok=True)
for i in range(1, N + 1):
    # 顔なしのノイズ画像（40×30 を作って 320×240 に拡大＝生成は速い。検出は全滅する）
    small = PILImage.new("RGB", (40, 30))
    small.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(40 * 30)])
    im = small.resize((320, 240), PILImage.BILINEAR)
    im.save(os.path.join(OUT, f"stress_{i:04d}.jpg"), "JPEG", quality=70)
    if i % 200 == 0:
        print(f"generated {i}/{N}")
print(f"done: {N} photos -> {OUT}")
