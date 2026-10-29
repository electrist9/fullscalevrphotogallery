# ARCHITECTURE.md — システムアーキテクチャ

> 最終更新: 2026-10-29。状態記録は PROJECT_STATE.md、決定理由は DECISIONS.md。

## 1. 全体構成

```
┌──────────────── PC (Windows, LAN IP 192.168.100.25) ────────────────┐
│ 写真フォルダ (config.json photos_root, 既定 Photos/)                  │
│        │ indexer.py（走査→サムネイル→顔/姿勢検出→SQLite）             │
│        ▼                                                            │
│ data/app.db (photos / faces / thumbs BLOB)                          │
│        │                                                            │
│ server/app.py  FastAPI + Uvicorn  HTTPS :8443 (config.json port)    │
│   API: /api/health /api/photos /api/albums /api/photos/{pid}        │
│        POST /api/reindex  /api/index/progress  /thumbs/{pid}        │
│   静的: /photos → photos_root（原寸表示用フル解像）、/ → web/dist     │
└───────────┬─────────────────────────────────────────────────────────┘
            │ WiFi LAN（mkcert LAN証明書・HTTPS必須: WebXRはsecure context要件）
            ▼
┌──────── Quest 3 ブラウザ（HMD単体、PCリンク無し） ────────┐
│ web/dist（Vite+TS+Three.js）                            │
│  2Dページ (main.ts/gallery.ts) → 「VR表示」→ immersive-vr │
│  xrGallery.ts: アークギャラリー＋アルバムチップ＋詳細原寸大 │
│  設定は localStorage (fsvg.*)                            │
└─────────────────────────────────────────────────────────┘
```

- サーバーは Python、クライアントは TypeScript。**サーバー変更のみでクライアント不変なら web 再ビルド不要**（クライアントは相対URL、`/api/*`・`/thumbs/*`・`/photos/*` のパスは固定）。
- 認証なし（自宅LAN前提の決定）。HTTPS は WebXR 要件でありセキュリティ目的ではない。

## 2. ディレクトリ構成

```
fullscalevrphotogallery/
├─ PLAN.md                  # 計画書＋変更履歴の正典
├─ PROJECT_STATE.md / ARCHITECTURE.md / DECISIONS.md / TODO.md   # 状態記録（本群）
├─ config.json              # port / photos_root / album_mode（コミット済み）
├─ requirements.txt         # fastapi==0.162.0 uvicorn==0.54.0 pillow==13.0.0 mediapipe==1.1.1 numpy==2.5.4 pytest==9.1.1
├─ Photos/                  # 既定の写真データ（gitignore）
├─ certs/                   # mkcert 証明書（gitignore）: cert.pem key.pem
├─ data/                    # app.db・thumbs/（gitignore、実行生成物）
├─ models/                  # face_landmarker.task / pose_landmarker_full.task（オフライン同梱）
├─ server/                  # Python サーバー（下記 §3）
├─ web/                     # Vite+TS クライアント（下記 §4）
├─ scripts/                 # start-server.ps1 / build-web.ps1 / setup.ps1 / setup-cert.ps1 / facecheck.py / make_fixture.py
├─ tools/                   # mkcert.exe / _make_stress_photos.py（1000枚生成）/ _stress_index_run.py / _check_*.py
├─ .venv/                   # Python 環境（gitignore）
├─ tools/node/ + .pnpm-store/  # Node/pnpm 同梱（gitignore、workspace自己完結）
└─ PortableGit/             # git 同梱（gitignore。git は & PortableGit\bin\git.exe で呼ぶ）
```

## 3. サーバー（Python / FastAPI）

### 3.1 `server/config.py` — 設定の単一読込口

- `load_config(path=CONFIG_PATH) -> dict` → `{"port": int, "photos_root": str(絶対パス), "album_mode": 1|2}`。
- `ROOT = dirname(dirname(abspath(__file__)))`（リポジトリ直下）。`CONFIG_PATH = ROOT/config.json`。
- Tolerant 解析（設定項目すべて共通パターン）: ファイル無し→無言で既定。JSON壊れ・型不正・範囲外→**日本語警告 print**＋既定値。
  - `port` 既定 8443（1–65535）。`photos_root` 既定 `Photos`（相対は ROOT 基準、絶対パス可、**存在しなければ自動作成**）。`album_mode` 既定 1（1/2 のみ、bool は弾く）。
- `album_for_rel(rel: str, mode: int) -> str` — **アルバムキー導出の単一実装**（indexer とテストとreindex同期が同じ関数を使う）。
  - mode 1: `rel.rsplit("/",1)[0]`（直属の親。`a/b/c.jpg`→`a/b`、直下→`''`）
  - mode 2: `rel.split("/",1)[0]`（第一階層のみ。`a/b/c.jpg`→`a`、直下→`''`）
  - relpath は常にスラッシュ区切り・photos_root 相対。

### 3.2 `server/db.py` — SQLite

- `DB_PATH = ROOT/data/app.db`（**モジュールレベル変数。テスト/e2eでは monkeypatch して `.tmp/` 別DBに**）。`THUMB_DIR = ROOT/data/thumbs`。`connect()` が `CREATE TABLE IF NOT EXISTS` を実行。
- `photos`: `id PK, relpath TEXT UNIQUE NOT NULL, filename, album TEXT NOT NULL DEFAULT '', path, width, height, size, mtime, detect_ver, thumb BLOB`。relpath=photos_root 相対スラッシュ区切りが一意キー。album は album_mode で意味が変わるキー（`''`=直下）。
- `faces`: `photo_id FK(ON DELETE CASCADE), face_index, bbox TEXT(JSON [x0,y0,x1,y1]), pupil_px, roll_deg, yaw_deg, conf, eye_cx, eye_cy, crown_y, sole_y, height_mm, method, is_main`。
- ヘルパー: `upsert_photo(...)` / `insert_face(...)` / `set_thumb(con, pid, bytes)`。

### 3.3 `server/indexer.py` — インデックスパイプライン

- モジュール import 時に `_CFG = config.load_config()` → `PHOTO_DIR` / `ALBUM_MODE`（**サーバー起動時のみ反映。変更は再起動が必要**）。
- `SUPPORTED = (".jpg",".jpeg",".png",".webp",".bmp")`（HEIC 対象外＝無視、決定済み）。`.` 始まりの隠しファイル/フォルダと `calibration*` は除外。
- `iter_photo_relpaths()`: `os.walk`、dirnames ソート済み・隠し除外、`rel.replace(os.sep,"/")`。
- `make_thumb`: 最大辺 256px の WebP q82（`THUMB_MAX=256`）。
- 検出: `facedetect.detect_all(path)` を呼び `db.insert_face`。`detect_ver=facedetect.DETECT_VERSION` を photos 行に保存。
- `_needs_reindex(con, path, rel)`: 行無し / detect_ver 不一致 / mtime・size 変化 / thumb BLOB 無し → 再処理。
- `reindex_all(force)`: 差分スキャン（force=False が既定）。既存で変更要な写真は**スキップ分岐で保存済み album と `config.album_for_rel(rel, ALBUM_MODE)` を比較し、違えば album 列だけ UPDATE**（顔再検出なし→album_mode 切替が1000枚で数秒）。消えたファイルの行は DELETE（faces/thumbs は CASCADE）。50件ごと commit。
- 進捗: `PROGRESS` dict + `PROGRESS_LOCK`、`get_progress()`。`start_reindex_async(force)` がワーカースレッドで実行（`POST /api/reindex` から呼ぶ。起動時にも自動で差分スキャン）。
- `python server/indexer.py` 単体実行可（relpath:faces を出力）。

### 3.4 `server/facedetect.py` — 顔・虹彩・姿勢（検出戦略 v2）

- MediaPipe Tasks（CPU）。`MODEL = models/face_landmarker.task`（refineLandmarks=虹彩あり）、`POSE_MODEL = models/pose_landmarker_full.task`。
- `DETECT_VERSION = 2`。photos.detect_ver と違う写真のみ差分再スキャンで再検出（**検出戦略を変えたら必ず上げる**）。
- FaceLandmarker `num_faces=5`、min_face_detection_confidence 0.3。
- **検出チェーン（1枚内で段階的に試行、最初の成功で確定）**: ①フル画像 → ②人物らしき crop → ③3×3 タイル → ④Pose で得た鼻位置周辺の crop（posecrop）。遠景・小顔・横顔を救うため（2026-10-28 v2、PLAN.md 変更履歴参照）。
- 瞳間隔 `pupil_px`: 虹彩ランドマーク 468/473 の中心距離。`roll_deg`（顔傾き）、`yaw_deg`（向き）、`eye_cx/eye_cy`（目の中心）、`crown_y`（頭頂）。
- Pose（`num_poses=1`）→ `{sole_y（足先）, hip_cy, nose_x, nose_y}` を faces に保存。全身原寸の接地・身長算出に使用。
- メガネ・閉眼等は信頼度で吸収（虹彩精度の限界は PLAN §4.3）。

### 3.5 `server/scale.py` — 原寸大の数学

- 実IPD（mm、既定63）÷ `pupil_px` = **mm/px** → 写真1px の実寸。
- 身長 = `(sole_y - crown_y) × mm/px`（mm）。`method` に検出経路を記録。
- クライアントが `/api/photos/{pid}` の faces からスケールを計算して適用（計算自体は `web/src/photoPlane.ts` 側にも対応ロジックあり）。`server/tests/test_scale.py`（5件）が実 Photos のキャリブ写真で誤差を検証。

### 3.6 `server/app.py` — API・配信

| 定義 | 内容 |
|---|---|
| `GET /api/health` | 生存確認＋インデックス進捗 |
| `GET /api/photos` | `album`（省略=すべて）・`limit/offset` で photos JSON（faces 同梱） |
| `GET /api/albums` | album 列で GROUP BY、件数付き（`''`=photos_root 直下） |
| `GET /api/photos/{pid}` | 1枚詳細（faces 付き） |
| `POST /api/reindex` | `start_reindex_async(force)` 起動 |
| `GET /api/index/progress` | 進捗 JSON（2D/VR の進捗UIがポーリング） |
| `GET /thumbs/{pid}` | サムネイル BLOB 配信 |
| `mount /photos` | `StaticFiles(directory=indexer.PHOTO_DIR)` — 詳細表示のフル解像画像（日本語名は URL encode） |
| `mount /` | `StaticFiles(web/dist, html=True)` — ビルド済みクライアント |
- `main()`: `config.load_config()["port"]` で uvicorn を `ssl_keyfile/ssl_certfile`（certs/）付き `0.0.0.0:<port>` で起動。

## 4. Webクライアント（Vite + TypeScript + Three.js + WebXR）

### 4.1 ファイル構成（`web/src/`）

| ファイル | 役割 |
|---|---|
| `main.ts` | エントリ。2Dページ構築、VR開始（`immersive-vr` セッション要求）、2D→VR へアルバム選択の引き継ぎ |
| `gallery.ts` | 2Dページの一覧・アルバムセレクト |
| `api.ts` | `/api/*`・`/thumbs/*` fetch ラッパ |
| `photoPlane.ts` | 写真プレーン生成（アスペクト、mm/px→スケール適用） |
| `xr-input.ts` | コントローラ入力（`rightStickRaw()` デッドゾーン付き連続値、X/トリガー等） |
| `settings.ts` | localStorage 設定（下記 4.4） |
| `xrGallery.ts` | **VR本体（約1100行）**。下記 4.2–4.3 |

### 4.2 VRギャラリー（xrGallery.ts）— 空間レイアウト定数

```
R = 3.4            パネル配置半径 (m)
ROW_Y = 1.3        ギャラリー1段の高さ（旧3段は 2026-10-28 に廃止）
VISIBLE_ARC = 2.4  表示ウィンドウ合計円弧角 (rad)
TEX_CACHE_MAX = 48 サムテクスチャ LRU 上限（ウィンドウ約16枚＋余裕）
CHIP_Y = 1.8       アルバムチップ行の高さ
CHIP_THUMB_H = 0.28 / CHIP_THUMB_W_MAX = 0.42 / CHIP_GAP = 0.14 / CHIP_LABEL_MAX = 12
EYE_Y = 1.5        フィット表示中心高さ
DETAIL_DIST = 2.4  詳細 root の頭アンカー距離（写真距離は photoGroup オフセット＝設定値）
DETAIL_FIT = 2.2   フィット表示最大辺 (m)
```

- **1段アーク＋連続スクロール**: 右スティック X で角度を `scrollRadPerSec`（既定1.2 rad/s）で連続積分。ウィンドウ内のパネルだけ生成・テクスチャは LRU（48）。隙間は目隠しメッシュ（galleryBand h0.7 c1.3 / albumBand h0.4 c1.85、`BAND_A=1.9`）。
- **アルバムチップ行**: ギャラリー上部 y=1.80 に連続スクロール。各アルバムの先頭写真（ORDER BY relpath）のサムネイル＋名前（12字省略、フォント4.5cm）。**アスペクト比は常に正確**（高さ基準、横長のみ高さ縮小）。先頭に「すべて (N)」チップ（`{album:null, first:photos[0]}`）。チップ選択でアルバム切替。
- **床**: 無限グリッド（y=0.001、Z-fighting回避）＋折り曲げストリップ（y=0.002、全身表示で画像が床下に余る分を手前へ折る）。接地ガイド帯（青四角）は廃止済み。
- **詳細表示（3モード、開いた時点で固定）**: 全身=sole_y 床接地（床折り込み）／半身=画像内目を `eyeLifeM`（既定1.45m）に固定／フィット=最大辺 `DETAIL_FIT`。表示距離は設定の `distLifeFullM`/`distLifeHalfM`/`distFitM`（0.5–5.0m、既定 1.0/1.0/2.4）。アンカー root は床 y=0 の頭基準。
- **UI**: ⚙（XR設定パネル、6スライダー）と 🚪（VR退出、⚙ の右=案A配置）。情報パネル（ファイル名/アルバム/身長/mm-px）はデフォルト非表示、**Xボタン**でトグル（Questに物理Y無し）。トリガー=選択→詳細、戻る=詳細閉じる。
- 顔なし・低信頼はフィット表示にフォールバック（クラッシュしない）。

### 4.3 2Dページ

一覧（サムネイル・アルバムセレクト・件数）、インデックス進捗UI、VR開始ボタン。2Dで選んだアルバムが VR 開始時に引き継がれる。

### 4.4 設定（localStorage、prefix `fsvg.`）

| キー | 範囲 | 既定 | 内容 |
|---|---|---|---|
| `fsvg.photo.ipdmm` | 50–80 | 63 | 写真の被写体IPD（mm）。原寸スケールの基準 |
| `fsvg.eyeLifeM` | 1.0–2.0 | 1.45 | 半身原寸の目の高さ |
| `fsvg.scrollRadPerSec` | 0.4–3.0 | 1.2 | ギャラリー連続スクロール速度 |
| `fsvg.distLifeFullM` | 0.5–5.0 | 1.0 | 全身表示距離 |
| `fsvg.distLifeHalfM` | 0.5–5.0 | 1.0 | 半身表示距離 |
| `fsvg.distFitM` | 0.5–5.0 | 2.4 | フィット表示距離 |

- 読み取りは範囲外・非数値なら既定にフォールバック（`settings.ts`）。HMD側のブラウザ localStorage に保存される。

### 4.5 ビルド・開発

- `scripts/build-web.ps1`: `tools\node\node.exe` + `tools\node\node_modules\pnpm\bin\pnpm.cjs` で `pnpm install && pnpm run build` → `web/dist`（FastAPI が `/` にマウント）。
- dev: `pnpm run dev`（port 5173）。`vite.config.ts` が `../config.json` を `readFileSync` で読み、`/api`・`/thumbs`・`/photos` プロキシ先を `https://192.168.100.25:<port>` に。dev は PCブラウザ用（WebXR 実機は dist 配信で行う）。`vite.config.ts` は `tsc -b` の型チェック対象外。

## 5. HTTPS・証明書

- `scripts/setup-cert.ps1` が `tools\mkcert.exe` で**ローカルCA＋LAN IP（192.168.100.25）SAN 証明書**を `certs/` に生成（gitignore）。Quest 側に mkcert ルートCA をインストールして警告を消している（初期設定済み・2026-10-24）。
- 証明書はポート非依存 → `port` 変更で再生成不要。WebXR は secure context 必須のため HTTPS は必須インフラ。

## 6. アルバム意味論（album_mode）

- `photos.album` は**アルバムキー文字列**で、意味は `album_mode` 依存（mode1=直属の親相対パス／mode2=第一階層のみ）。API・クライアントは文字列をそのまま扱う（モード非依存）。
- 導出は `config.album_for_rel()` の単一実装。モード切替後は起動時差分スキャンが album 列だけ UPDATE（§3.3）。
- クライアントの「すべて」は疑似アルバム（`album=null`→全件）。`''` は「photos_root 直下」の実在アルバム。

## 7. 性能設計（Questブラウザのメモリ上限対策）

- サムネイル 256px WebP（BLOB配信）→ ギャラリーはテクスチャ LRU 48枚上限、ウィンドウ約16枚のみ生成。
- 差分再インデックス（mtime/size/detect_ver/thumb）で起動高速化。1000枚フル再構築で約35秒（顔検出込み）。
- 原寸詳細のみフル解像（`/photos` 静的配信）。受け入れ基準: 500枚で概ね72fps維持（目標60fps以上、実測は実機確認済み）。
