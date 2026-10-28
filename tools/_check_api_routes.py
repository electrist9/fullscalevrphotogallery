# サーバー起動なしのAPI検証: app.py のルートを関数として直接呼ぶ（ポートバインドしない）。
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
import db  # noqa: E402
import app as appmod  # noqa: E402

con = db.connect()
pid = con.execute("SELECT id FROM photos WHERE relpath LIKE '_stress/%' LIMIT 1").fetchone()[0]
row = appmod._photo_row(con, pid)
print("photo row thumb_url:", row["thumb_url"], "album:", row["album"], "file:", row["filename"])
con.close()

resp = appmod.thumb(pid)
print("thumb resp:", resp.media_type, len(resp.body), "bytes", "cache:", resp.headers.get("cache-control"))
print("webp magic:", resp.body[:4] == b"RIFF" and resp.body[8:12] == b"WEBP")

try:
    appmod.thumb(999999)
    print("404 NG: no exception")
except Exception as e:
    print("missing id ->", type(e).__name__, getattr(e, "status_code", None))

prog = appmod.index_progress()
print("progress keys:", sorted(prog.keys()), "running:", prog["running"])

photos = appmod.list_photos()
print("list_photos count:", len(photos))
