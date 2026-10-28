# Photos/ をスキャンし、サムネイル(BLOB) + 顔/虹彩 pupil_px + Pose足元 を DB にキャッシュ (M0)
# 2026-10-26: サムネイルは 1画像=1ファイル をやめ SQLite BLOB（thumbs表）へ。
#             差分再スキャン（mtime/size 変更分のみ）と進捗状態（/api/index/progress 用）を追加。
import importlib.util
import math
import os
import sys
import threading
import time
from io import BytesIO

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
if importlib.util.find_spec("PIL") is None:  # venv未導入時のみ .pylibs フォールバック
    sys.path.insert(0, os.path.join(ROOT, ".pylibs"))

from PIL import Image as PILImage  # noqa: E402
import db  # noqa: E402
import facedetect  # noqa: E402
import scale  # noqa: E402

PHOTO_DIR = os.path.join(ROOT, "Photos")
THUMB_MAX = 256
SUPPORTED = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

# ---- インデックス進捗（2Dページの進捗UIが /api/index/progress でポーリング） ----
PROGRESS_LOCK = threading.Lock()
PROGRESS = {
    "running": False,
    "total": 0,
    "done": 0,
    "skipped": 0,          # 差分再スキャンでスキップした枚数
    "current": "",         # 処理中のファイル（relpath）
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def get_progress():
    with PROGRESS_LOCK:
        return dict(PROGRESS)


def _set_progress(**kw):
    with PROGRESS_LOCK:
        PROGRESS.update(kw)


def start_reindex_async(force: bool = False) -> bool:
    """バックグラウンドスレッドで reindex_all。既に実行中なら False を返すだけ。"""
    with PROGRESS_LOCK:
        if PROGRESS["running"]:
            return False
        PROGRESS.update(
            running=True, total=0, done=0, skipped=0, current="",
            started_at=time.time(), finished_at=None, error=None,
        )

    def worker():
        try:
            reindex_all(force=force)
        except Exception as e:  # 進捗UIにエラーを映す
            _set_progress(error=f"{type(e).__name__}: {e}")
        finally:
            _set_progress(running=False, finished_at=time.time())

    threading.Thread(target=worker, daemon=True).start()
    return True


def make_thumb(pil_image) -> bytes:
    """サムネイル WebP をメモリ上に生成してバイト列で返す（ファイルは作らない）。"""
    im = pil_image.copy()
    im.thumbnail((THUMB_MAX, THUMB_MAX), PILImage.LANCZOS)
    buf = BytesIO()
    im.save(buf, "WEBP", quality=82)
    return buf.getvalue()


def iter_photo_relpaths():
    """Photos/ 以下を再帰走査。アルバム=サブフォルダ（Photos/ からの相対パス、スラ区切り）。
    隠しファイル/隠しフォルダと calibration* は除外。"""
    for dirpath, dirnames, filenames in os.walk(PHOTO_DIR):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for fn in sorted(filenames):
            if fn.startswith("."):
                continue
            if not fn.lower().endswith(SUPPORTED):
                continue
            if fn.lower().startswith("calibration"):
                continue  # キャリブ合成画像は一覧から除外（検証用）
            rel = os.path.relpath(os.path.join(dirpath, fn), PHOTO_DIR)
            yield rel.replace(os.sep, "/")


def migrate_thumb_files(con) -> int:
    """旧方式（data/thumbs/*.webp ファイル）→ thumbs表 BLOB への一度きりの移行。
    取り込み済みファイルは削除し、photos.thumb 列は NULL 化して二度と使わない。"""
    rows = con.execute(
        "SELECT p.id, p.thumb FROM photos p WHERE p.thumb IS NOT NULL AND p.thumb <> ''"
    ).fetchall()
    moved = 0
    for pid, name in rows:
        path = os.path.join(db.THUMB_DIR, name)
        if os.path.isfile(path):
            with open(path, "rb") as f:
                db.set_thumb(con, pid, f.read())
            os.remove(path)
            moved += 1
        con.execute("UPDATE photos SET thumb = NULL WHERE id = ?", (pid,))
    if rows:
        con.commit()
    return moved


def _needs_reindex(con, path, rel) -> bool:
    """差分再スキャン用: mtime/size が同じでサムネイルBLOBが存在すれば再スキャン不要。
    （faces が 0 件の写真も photos 行の存在＝以前インデックス済みとみなしてスキップ）"""
    st = os.stat(path)
    row = con.execute(
        "SELECT id, mtime, size_bytes FROM photos WHERE relpath = ?", (rel,)
    ).fetchone()
    if not row:
        return True
    pid, mtime, size_bytes = row
    if abs(mtime - st.st_mtime) > 1e-6 or size_bytes != st.st_size:
        return True
    if not con.execute("SELECT 1 FROM thumbs WHERE photo_id = ?", (pid,)).fetchone():
        return True
    return False


def index_photo(con, rel):
    path = os.path.join(PHOTO_DIR, rel.replace("/", os.sep))
    st = os.stat(path)
    filename = rel.rsplit("/", 1)[-1]
    album = rel.rsplit("/", 1)[0] if "/" in rel else ""
    with PILImage.open(path) as im:
        W, H = im.size
        thumb_bytes = make_thumb(im)  # BLOB 保存（ファイルは作らない）
        faces = facedetect.detect_faces(im)
        # 足元検出（Pose）: 身長=頭頂→足元、原寸大表示の足先=床接地に使用。主顔のみに紐付け
        pose = facedetect.detect_pose(im) if faces else None

    pid = db.upsert_photo(con, rel, filename, album, path, W, H, st.st_size, st.st_mtime, None)
    db.set_thumb(con, pid, thumb_bytes)
    if faces:
        faces.sort(key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]), reverse=True)
        for i, f in enumerate(faces):
            sole = pose["sole_y"] if (pose and i == 0) else None
            if sole is not None:
                face_h = f["bbox"][3] - f["bbox"][1]
                # 妥当性1: 足元は目の下（顔高さ×0.5以上下）でなければならない
                if f.get("eye_cy") is None or sole <= f["eye_cy"] + 0.5 * face_h:
                    sole = None
                # 妥当性2: Poseの頭（鼻）が主顔と一致（別人物/誤検出の除外）
                elif pose["nose_x"] is not None and math.hypot(
                    pose["nose_x"] - f["eye_cx"], pose["nose_y"] - f["eye_cy"]
                ) > 2.0 * face_h:
                    sole = None
                # 妥当性3: 解剖学比率 股関節→足元 / 頭頂→足元 が 0.35〜0.65
                # （半身写真でPoseが画像下端へ足を外挿した場合はほぼ0になり除外できる）
                elif (f.get("crown_y") is not None and pose["hip_cy"] is not None
                      and not 0.35 <= (sole - pose["hip_cy"]) / (sole - f["crown_y"]) <= 0.65):
                    sole = None
            mmpp = scale.mm_per_px(f["pupil_px"], f.get("yaw_deg"))
            db.insert_face(
                con, pid, f["bbox"], f["pupil_px"], f["roll_deg"], f["method"], i == 0,
                yaw_deg=f.get("yaw_deg"), conf=f.get("conf"),
                eye_cx=f.get("eye_cx"), eye_cy=f.get("eye_cy"),
                crown_y=f.get("crown_y"), sole_y=sole,
                height_mm=scale.height_mm(f.get("crown_y"), sole, mmpp),
            )
    return pid, len(faces)


def reindex_all(force: bool = False):
    """force=False: mtime/size 変更分のみ（起動時の再スキャンは速い）。
    force=True: 全写真を作り直し（2Dページの「再スキャン」ボタン）。"""
    con = db.connect()
    try:
        migrate_thumb_files(con)
        present = set()
        results = []
        rels = list(iter_photo_relpaths())
        _set_progress(total=len(rels), done=0)
        done = 0
        for rel in rels:
            present.add(rel)
            path = os.path.join(PHOTO_DIR, rel.replace("/", os.sep))
            if not force and not _needs_reindex(con, path, rel):
                done += 1
                with PROGRESS_LOCK:
                    PROGRESS["done"] = done
                    PROGRESS["skipped"] += 1
                continue
            _set_progress(current=rel)
            pid, nf = index_photo(con, rel)
            done += 1
            with PROGRESS_LOCK:
                PROGRESS["done"] = done
            results.append((rel, nf))
            if done % 50 == 0:
                con.commit()  # 1000枚規模でも進捗がDBに残り、API読み取りも進む
        # 消えた写真の削除（thumbs / faces は ON DELETE CASCADE で従属削除）
        for row in con.execute("SELECT id, relpath FROM photos").fetchall():
            if row[1] not in present:
                con.execute("DELETE FROM photos WHERE id = ?", (row[0],))
        con.commit()
        return results
    finally:
        con.close()


if __name__ == "__main__":
    for fn, nf in reindex_all(force=True):
        print(f"{fn}: faces={nf}")
