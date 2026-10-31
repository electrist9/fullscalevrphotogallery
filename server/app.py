# FastAPI アプリ本体 (M3): 一覧API（アルバム対応）+ 静的配信 + HTTPS起動
import importlib.util
import json
import mimetypes
import os
import sys
from urllib.parse import quote

mimetypes.add_type("image/webp", ".webp")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
if importlib.util.find_spec("fastapi") is None:  # venv未導入時のみ .pylibs フォールバック
    sys.path.insert(0, os.path.join(ROOT, ".pylibs"))

from fastapi import FastAPI, HTTPException, Response  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402
import downscale  # noqa: E402
import indexer  # noqa: E402
import facedetect  # noqa: E402

_CFG = config.load_config()

CERT_DIR = os.path.join(ROOT, "certs")
CRT = os.path.join(CERT_DIR, "server.crt")
KEY = os.path.join(CERT_DIR, "server.key")
WEB_DIST = os.path.join(ROOT, "web", "dist")
THEME_DIR = os.path.join(ROOT, "themes")  # テーマJSON格納（THEME_DESIGN.md §6.5）。内蔵plainはここに置かない

app = FastAPI(title="FullScaleVR Photo Gallery M0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.on_event("startup")
def _startup():
    # 2026-10-26: 起動時再スキャンは差分（mtime/size変更分のみ）をバックグラウンドで。
    # 進捗は GET /api/index/progress で取得（2Dページに進捗UI）。起動をブロックしない。
    indexer.start_reindex_async(force=False)


def _photo_row(con, pid):
    row = con.execute(
        "SELECT id, filename, relpath, album, width, height, size_bytes, "
        "EXISTS(SELECT 1 FROM thumbs t WHERE t.photo_id = photos.id) "
        "FROM photos WHERE id=?",
        (pid,),
    ).fetchone()
    if not row:
        return None
    faces = con.execute(
        "SELECT bbox, pupil_px, roll_deg, yaw_deg, conf, eye_cx, eye_cy, crown_y, sole_y, height_mm, method, is_main "
        "FROM faces WHERE photo_id=? ORDER BY is_main DESC",
        (pid,),
    ).fetchall()
    face_list = []
    for (bbox, pupil_px, roll_deg, yaw_deg, conf, eye_cx, eye_cy,
         crown_y, sole_y, height_mm, method, is_main) in faces:
        face_list.append({
            "bbox": json.loads(bbox),
            "pupil_px": pupil_px,
            "roll_deg": roll_deg,
            "yaw_deg": yaw_deg,
            "conf": conf,
            "eye_cx": eye_cx,
            "eye_cy": eye_cy,
            "crown_y": crown_y,    # 頭頂推定 y (px)
            "sole_y": sole_y,      # 足元 y (px)。未検出は null
            "height_mm": height_mm,  # 身長 (mm)。算出不可は null
            "method": method,
            "is_main": bool(is_main),
        })
    return {
        "id": row[0],
        "filename": row[1],
        "relpath": row[2],
        "album": row[3],
        "width": row[4],
        "height": row[5],
        "size_bytes": row[6],
        # 2026-10-26: サムネイルは SQLite BLOB（thumbs表）。ファイル配信をやめ DB から配信
        "thumb_url": f"/thumbs/{row[0]}" if row[7] else None,
        # relpath をそのまま URL に（/photos/{rel} ルートがサブフォルダも配信。日本語名のため quote）
        "photo_url": f"/photos/{quote(row[2])}",
        "faces": face_list,
    }


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/photos")
def list_photos(album: str | None = None):
    con = db.connect()
    try:
        if album is None:
            rows = con.execute("SELECT id FROM photos ORDER BY relpath").fetchall()
        else:
            rows = con.execute(
                "SELECT id FROM photos WHERE album=? ORDER BY relpath", (album,)
            ).fetchall()
        return [_photo_row(con, r[0]) for r in rows]
    finally:
        con.close()


@app.get("/api/albums")
def list_albums():
    """アルバム一覧（''=photos_root直下）。件数付き。"""
    con = db.connect()
    try:
        return [
            {"name": r[0], "count": r[1]}
            for r in con.execute(
                "SELECT album, COUNT(*) FROM photos GROUP BY album ORDER BY album"
            ).fetchall()
        ]
    finally:
        con.close()


@app.get("/api/themes")
def list_themes():
    """サーバ配信テーマ一覧（THEME_DESIGN.md §6.5）。themes/*.json を1ファイル=1テーマとして読む。
    id/base/accent が揃わないファイルはスキップ。内蔵 plain は含まない（クライアント既定）。"""
    if not os.path.isdir(THEME_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(THEME_DIR)):
        if not fn.lower().endswith(".json"):
            continue
        path = os.path.join(THEME_DIR, fn)
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                spec = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(spec, dict):
            continue
        if not (spec.get("id") and spec.get("base") and spec.get("accent")):
            continue
        out.append(spec)
    return out


@app.get("/api/photos/{pid}")
def get_photo(pid: int):
    con = db.connect()
    try:
        row = _photo_row(con, pid)
        if not row:
            raise HTTPException(404, "not found")
        return row
    finally:
        con.close()


@app.post("/api/reindex")
def reindex(force: bool = True):
    # 2026-10-26: 非同期化。進捗は GET /api/index/progress でポーリング（1000枚規模で待たせない）
    started = indexer.start_reindex_async(force=force)
    return {"started": started, "running": True}


@app.get("/api/index/progress")
def index_progress():
    return indexer.get_progress()


@app.get("/thumbs/{pid}")
def thumb(pid: int):
    """サムネイル BLOB 配信（旧 /thumbs StaticFiles マウントの代替）。"""
    con = db.connect()
    try:
        data = db.get_thumb(con, pid)
    finally:
        con.close()
    if data is None:
        raise HTTPException(404, "no thumb")
    return Response(
        content=data,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# 元写真配信（2026-10-31: 旧 StaticFiles マウントの代替。配信時ダウンスケール付き）。
# config.json の downscale_enabled=false でダウンスケール無効（原画そのまま配信）。
# 同期 def のため FastAPI のスレッドプールで実行され、Pillow 処理（23MP で約0.3秒）が
# イベントループ（API・サムネイル配信）をブロックしない。
_PHOTO_CACHE_HEADERS = {"Cache-Control": "public, max-age=300"}


@app.get("/photos/{rel:path}")
def serve_photo(rel: str):
    root = indexer.PHOTO_DIR
    target = os.path.normpath(os.path.join(root, rel.replace("/", os.sep)))
    # パストラバーサル対策（StaticFiles 相当）。photos_root 自体やその外は不可
    if target == root or not target.startswith(root + os.sep):
        raise HTTPException(404, "not found")
    if not os.path.isfile(target):
        raise HTTPException(404, "not found")
    ext = os.path.splitext(target)[1].lower()
    if _CFG["downscale_enabled"] and ext in downscale.SUPPORTED_EXTS:
        size = downscale.probe_size(target)
        if size and max(size) > config.DOWNSCALE_MAX_PX:
            cache_dir = _CFG["downscale_cache_dir"]
            cache_file = downscale.cache_path_for(
                target, rel, cache_dir, config.DOWNSCALE_MAX_PX, config.DOWNSCALE_JPEG_QUALITY
            )
            if os.path.isfile(cache_file):
                return FileResponse(cache_file, media_type="image/jpeg", headers=_PHOTO_CACHE_HEADERS)
            try:
                data = downscale.render_downscaled(
                    target, config.DOWNSCALE_MAX_PX, config.DOWNSCALE_JPEG_QUALITY
                )
            except (OSError, ValueError) as e:
                print(f"ダウンスケール変換に失敗したため原画を配信: {target}: {e}")
                data = None
            if data is not None:
                try:
                    os.makedirs(cache_dir, exist_ok=True)
                    tmp = f"{cache_file}.{os.getpid()}.tmp"
                    with open(tmp, "wb") as f:
                        f.write(data)
                    os.replace(tmp, cache_file)  # 同時リクエストでも破損しないアトミック差し替え
                except OSError as e:
                    print(f"ダウンスケールキャッシュ書込失敗、メモリ内配信: {e}")
                return Response(content=data, media_type="image/jpeg", headers=_PHOTO_CACHE_HEADERS)
    media = mimetypes.guess_type(target)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media, headers=_PHOTO_CACHE_HEADERS)


# 静的配信: フロントエンド（元写真は /photos/{rel} ルート、サムネイルは /thumbs/{id} エンドポイント）
if os.path.isdir(WEB_DIST):
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


def main():
    import uvicorn
    import config
    if not (os.path.isfile(CRT) and os.path.isfile(KEY)):
        print("証明書がありません。scripts\\setup-cert.ps1 を実行してください。")
        sys.exit(1)
    port = config.load_config()["port"]
    print(f"FullScaleVR M0: https://192.168.100.25:{port}  (Quest 3 Browser で開く)")
    print(f"ポートは config.json の port で変更できます（編集後はサーバー再起動）")
    uvicorn.run(
        app, host="0.0.0.0", port=port,
        ssl_certfile=CRT, ssl_keyfile=KEY,
    )


if __name__ == "__main__":
    main()
