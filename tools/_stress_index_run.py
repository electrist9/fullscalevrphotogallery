# 1000枚規模の快適性検証: 差分インデックス（force=False）の計測とDB状態の報告。
# 使い方: .venv\Scripts\python.exe tools\_stress_index_run.py
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
import db  # noqa: E402
import indexer  # noqa: E402

t0 = time.time()
res = indexer.reindex_all(force=False)
elapsed = time.time() - t0
prog = indexer.get_progress()
print(f"indexed(new/changed)={len(res)} elapsed={elapsed:.1f}s")
print(f"progress: total={prog['total']} done={prog['done']} skipped={prog['skipped']}")

con = db.connect()
n_photos = con.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
n_thumbs = con.execute("SELECT COUNT(*) FROM thumbs").fetchone()[0]
thumb_bytes = con.execute("SELECT SUM(LENGTH(data)) FROM thumbs").fetchone()[0] or 0
n_faces = con.execute("SELECT COUNT(*) FROM faces").fetchone()[0]
con.close()
db_size = os.path.getsize(db.DB_PATH)
print(f"photos={n_photos} thumbs={n_thumbs} thumb_bytes={thumb_bytes/1e6:.1f}MB faces={n_faces}")
print(f"db_size={db_size/1e6:.1f}MB")
leftover = os.listdir(db.THUMB_DIR) if os.path.isdir(db.THUMB_DIR) else []
print(f"legacy thumb files left: {len(leftover)}")
