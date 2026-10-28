# SQLite スキーマとヘルパー (M0)
import os
import sqlite3
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "app.db")
THUMB_DIR = os.path.join(ROOT, "data", "thumbs")

SCHEMA = """
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relpath TEXT UNIQUE NOT NULL,     -- Photos/ からの相対パス（スラ区切り）。一意キー
  filename TEXT NOT NULL,           -- 表示用ファイル名（basename）
  album TEXT NOT NULL DEFAULT '',   -- アルバム=Photos/ 直下の相対フォルダパス。''=直下
  path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime REAL NOT NULL,
  thumb TEXT,
  indexed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS faces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bbox TEXT NOT NULL,           -- JSON [x0,y0,x1,y1]
  pupil_px REAL,                -- 虹彩中心間距離 (px)。検出失敗は NULL
  roll_deg REAL,                -- 虹彩線の傾き (deg)
  yaw_deg REAL,                 -- 首振り推定 (deg)。§4.2 姿勢補正用
  conf REAL,                    -- 信頼度 0〜1（顔サイズ・yaw由来）
  eye_cx REAL,                  -- 虹彩中心の中点 x (px、フル画像座標)
  eye_cy REAL,                  -- 同 y。原寸大の目の高さ配置に使用
  crown_y REAL,                 -- 頭頂推定 y (px)。身長=頭頂→足元に使用
  sole_y REAL,                  -- Pose検出の足元 y (px)。足先=床接地に使用。未検出は NULL
  height_mm REAL,               -- 身長 (mm) = (sole_y - crown_y) × mm/px。算出不可は NULL
  method TEXT,                  -- full | top50 | top30 | 2x | none
  is_main INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS thumbs (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  data BLOB NOT NULL            -- サムネイル WebP 実体。1000枚規模でファイル数が増えないようDB保存（2026-10-26）
);
"""


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")       # インデックス中もAPI読み取りをブロックしない
    con.execute("PRAGMA busy_timeout = 5000")
    con.executescript(SCHEMA)
    _migrate(con)
    return con


def _migrate(con):
    """M3: photos の一意キーを filename → relpath（サブフォルダ=アルバム対応）へ変更。
    UNIQUE 制約は ALTER できないため旧スキーマならテーブル再作成。
    DB は起動時 reindex で再生成されるためデータ損失なし（顔検出も再実行）。"""
    cols = {r[1] for r in con.execute("PRAGMA table_info(photos)")}
    if "relpath" not in cols:
        con.execute("DROP TABLE IF EXISTS faces")
        con.execute("DROP TABLE IF EXISTS photos")
        con.executescript(SCHEMA)
    # M2で追加した faces 列を既存DBへ後付け（ALTER TABLE）。
    cols = {r[1] for r in con.execute("PRAGMA table_info(faces)")}
    for name, typ in (
        ("yaw_deg", "REAL"), ("conf", "REAL"), ("eye_cx", "REAL"), ("eye_cy", "REAL"),
        ("crown_y", "REAL"), ("sole_y", "REAL"), ("height_mm", "REAL"),
    ):
        if name not in cols:
            con.execute(f"ALTER TABLE faces ADD COLUMN {name} {typ}")


def upsert_photo(con, relpath, filename, album, path, width, height, size_bytes, mtime, thumb):
    con.execute(
        """INSERT INTO photos (relpath, filename, album, path, width, height, size_bytes, mtime, thumb, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(relpath) DO UPDATE SET
             filename=excluded.filename, album=excluded.album,
             path=excluded.path, width=excluded.width, height=excluded.height,
             size_bytes=excluded.size_bytes, mtime=excluded.mtime,
             thumb=excluded.thumb, indexed_at=excluded.indexed_at""",
        (relpath, filename, album, path, width, height, size_bytes, mtime, thumb, time.time()),
    )
    cur = con.execute("SELECT id FROM photos WHERE relpath = ?", (relpath,))
    pid = cur.fetchone()[0]
    con.execute("DELETE FROM faces WHERE photo_id = ?", (pid,))
    return pid


def insert_face(con, photo_id, bbox, pupil_px, roll_deg, method, is_main,
                yaw_deg=None, conf=None, eye_cx=None, eye_cy=None,
                crown_y=None, sole_y=None, height_mm=None):
    import json
    con.execute(
        """INSERT INTO faces (photo_id, bbox, pupil_px, roll_deg, yaw_deg, conf, eye_cx, eye_cy,
                              crown_y, sole_y, height_mm, method, is_main)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (photo_id, json.dumps(bbox), pupil_px, roll_deg, yaw_deg, conf, eye_cx, eye_cy,
         crown_y, sole_y, height_mm, method, 1 if is_main else 0),
    )


def set_thumb(con, photo_id, data: bytes):
    """サムネイル WebP バイト列を BLOB として保存（photos.thumb 列は廃止済み）。"""
    con.execute(
        "INSERT INTO thumbs (photo_id, data) VALUES (?, ?) "
        "ON CONFLICT(photo_id) DO UPDATE SET data = excluded.data",
        (photo_id, data),
    )


def get_thumb(con, photo_id: int):
    row = con.execute("SELECT data FROM thumbs WHERE photo_id = ?", (photo_id,)).fetchone()
    return row[0] if row else None
