# PROJECT_STATE.md — プロジェクト現在状態

> 最終更新: 2026-10-30（Asia/Tokyo）／ 対象リポジトリ: `F:\fullscalevrphotogallery`（branch `main` @ `1cd8519`、**M4 完了・GitHub 公開済み**）
> 本ファイルは別セッションのLLMが開発を継続するための状態記録。設計詳細は ARCHITECTURE.md、決定理由は DECISIONS.md、残作業は TODO.md。履歴の正典は PLAN.md（変更履歴セクション）。

## 1. プロジェクト概要

PC上の写真フォルダを、Quest 3 の WebXRブラウザ（HMD単体・PCリンク不要）で見るWebアルバムアプリ。
中核価値は **原寸大表示**: サーバー側で MediaPipe 顔ランドマーク＋虹彩から瞳間隔（px）を測り、実IPD（既定63mm）で mm/px を算出、写真の人物をVR内で実物大にスケーリングして表示する。足先（Pose検出）を床に接地し、身長（頭頂→足元）を情報表示。

- サーバー: Python 3.12（`.venv`）+ FastAPI + Uvicorn（HTTPS）。顔検出・サムネイル生成・SQLiteインデックス。
- クライアント: Vite + TypeScript + Three.js + WebXR（`immersive-vr`）。Quest 3ブラウザが唯一の実機ターゲット。
- 通信: 自宅LAN（WiFi）。PCのLAN IP `192.168.100.25`、既定ポート **8443**。Questから `https://192.168.100.25:8443/` を開く。

## 2. 現在の到達点（すべて Quest 3 実機確認済み）

マイルストーン（PLAN.md §7）: **M0・M1・M2・M3・M4 完了（2026-10-30）**。M4（品質・配布）の内容: 公開前掃除、配布物一式（`scripts/setup.ps1`／README.md（日本語）／LICENSE（MIT）／`scripts/make-release.ps1`）、**§9-3 実機 ±5% 検証 PASS（2026-10-30、3/3・最大誤差 +1.24%、`Photos/calib/1〜3.png`）**、**オフライン配布形式（2026-10-30、feature/offline-dist）**: zip に Python ランタイム（`runtime\`、tools\pyruntime 406MB）と `fsvg.exe`（csc.exe ビルドのランチャー）と mkcert.exe を同梱し、「展開して fsvg.exe をダブルクリックだけ・オフライン完結」に変更（zip 160.4MB。詳細は PLAN.md 変更履歴）、**GitHub 公開（2026-10-30・ユーザー手動実施）**: `https://github.com/electrist9/fullscalevrphotogallery` に main push ＋ Release `v0.9.0` に zip 添付済み（`scripts/publish-github.ps1` は未使用でリポジトリに残置）。30分実測はサンドボックス権限問題でスキップ記録（TODO.md §1）。**M5（拡張）は任意・未着手**。

実機確認済みの機能（詳細履歴は PLAN.md §2 変更履歴、各項目に「Quest 3 実機確認（日付、OK）」サブ項目あり）:

| 領域 | 状態 |
|---|---|
| HTTPS起動・immersive-vr セッション | 2026-10-24 OK（mkcert LAN証明書） |
| 2Dページ（一覧・アルバム選択・VR開始） | OK |
| VRギャラリー: 1段アーク配置＋右スティック連続スクロール（1000枚で「非常に快適」） | 2026-10-28 OK |
| アルバムサムネイルチップ行（ギャラリー上部、連続スクロール、「すべて (N)」チップ） | 2026-10-28 OK |
| 詳細表示: 全身（足先床接地＋床折り曲げストリップ）／半身（既定1.45m）／フィット、3モード＋表示距離設定 | OK |
| 顔検出 v2（crop/tile3x3/posecrop チェーン、DETECT_VERSION=2） | 2026-10-28 OK |
| XR設定パネル6行（写真IPD・半身の目の高さ・スクロール速度・全身/半身/フィット表示距離） | OK |
| 退出ボタン 🚪（⚙ の右）、2D→VRアルバム同期、情報パネル Xボタン トグル | OK |
| 床グリッド Z-fighting 修正（grid y=0.001）、床接地ガイド帯の廃止 | 2026-10-29 OK |
| config.json 設定3項目: `port` / `photos_root` / `album_mode` | 2026-10-29 OK |

## 3. 現在の設定（`config.json`、コミット済み・シークレット無し）

```json
{
  "port": 8443,
  "photos_root": "Photos",
  "album_mode": 2
}
```

- **`album_mode: 2` はユーザー環境の現運用値**（第一階層ディレクトリのみアルバム）。既定は 1（全ディレクトリ/サブディレクトリ別アルバム）。編集→サーバー再起動で反映、GUIなし。
- 不正値は日本語警告を出して既定へフォールバック（`server/config.py`）。
- 非8443ポートに変更した場合、管理者権限で `netsh advfirewall firewall add rule name="FSVR Gallery <ポート>" dir=in action=allow protocol=TCP localport=<ポート>` が必要（既存許可ルールは8443用）。証明書はポート非依存（SANはIP/localhostのみ）で再生成不要。

## 4. 現在のデータ状態（`data/app.db`、gitignore）

- 写真 **61枚** インデックス済み（2026-10-29 の公開前掃除で `Photos/_stress/` の負荷テスト生成写真1000枚を削除、差分再インデックスで DB からも除去済み。生成スクリプト `tools/_make_stress_photos.py` は保持・再実行可）。内訳: 直下6、AlbumA/B/C（2/2/25）、testalbum系17アルバム（各1〜3）、tetalbum10 1、日本語名・絵文字名フォルダ各1（計7）。
- faces 62件。サムネイルは DB BLOB（WebP 256px q82・合計0.5MB）。
- album_mode=2 適用後のアルバム列（`''` 6, `AlbumA` 2, `AlbumB` 2, `AlbumC` 25, testalbum系 各1〜3, tetalbum10 1, 日本語名等 各1）。

## 5. 実行方法

```powershell
# サーバー起動（HTTPS・ポートは config.json）
powershell -File scripts\run.ps1                   # ユーザー向け起動（runtime\python.exe → .venv の順解決。初回は証明書自動生成＋Quest URL表示）。zip版は fsvg.exe がこれを呼ぶ
powershell -File scripts\start-server.ps1          # 開発者向け手動起動（runtime\python.exe → .venv の順解決）

# Web のビルド（web/dist を FastAPI が / にマウントして配信）
powershell -File scripts\build-web.ps1           # tools\node\node.exe + pnpm install && pnpm run build

# 開発（PCブラウザで http://localhost:5173、APIは ../config.json のポートへプロキシ）
# ※ WebXR は localhost では immersive-vr に入れないため、実機確認は web/dist 配信（8443）で行う

# 証明書再生成（certs/ が無い・期限切れの場合）
powershell -File scripts\setup-cert.ps1          # tools\mkcert.exe で LAN IP 証明書

# テスト
.venv\Scripts\python.exe -m pytest server\tests -q   # 2026-10-29 時点: 21 passed
```

Quest 3 での確認手順（確立済みワークフロー）: PCでサーバー起動 → Questブラウザで `https://192.168.100.25:<port>/` → 2Dページで「VR表示」→ immersive-vr。

## 6. 開発ワークフロー（このプロジェクトの確立手順 — 必ず守ること）

1. `main` の tip から `feature/<name>` ブランチを切る。
2. 実装 → PCでスモーク検証（pytest、必要なら `.tmp/` に検証スクリプト、DBを触る検証は `db.DB_PATH` を monkeypatch して `.tmp/` の別DBで行う）。
3. **ユーザーに日本語で変更点を報告し、Quest 3 実機確認を依頼**（確認項目を番号付きで明示）。
4. ユーザーOK（例「実機で全て確認OKです」）後に: PLAN.md 変更履歴に項目追加（済みの場合は「Quest 3 実機確認待ち」→「Quest 3 実機確認済み」に更新＋「**Quest 3 実機確認（YYYY-MM-DD、OK）**: ①… ②… — N項目すべて想定通り。」サブ項目）→ commit。
5. `git checkout main && git merge --no-ff feature/<name>` → ブランチ削除。
6. **git は必ず `& PortableGit\bin\git.exe`**（git が PATH に無い。PortableGit はリポジトリ直下に同梱）。

- サーバーのみ変更で Web クライアント不変なら **web 再ビルド不要**（クライアントは相対URL）。Web 変更時は `build-web.ps1` 後に dist バンドル名（現在 `index-DT2L8EYd.js`、500.15 kB / gzip 131.00 kB）を PLAN.md に記録する慣習。
- 設定系の新項目は port / photos_root / album_mode と同じパターンで: `config.json` キー追加 → `server/config.py` の `load_config()` で tolerant 解析（日本語警告＋既定フォールバック）→ 使用側参照 → `test_config.py` にテスト追加 → `start-server.ps1` コメント更新。

## 7. 環境・サンドボックス上の注意（Windows / DSH環境）

- OS: Windows。シェル: PowerShell（WinPS 5.1 系。`Invoke-WebRequest -SkipCertificateCheck` 不可）。
- git: `& PortableGit\bin\git.exe`（`git` 単独では CommandNotFoundException）。CRLF警告は benign。
- Node/pnpm: `tools\node\`（システムNode不要・workspace自己完結）。pnpm store は `.pnpm-store/`。
- Python: `.venv\Scripts\python.exe`。依存は `requirements.txt`（fastapi 0.162.0 / uvicorn 0.54.0 / pillow 13.0.0 / mediapipe 1.1.1 / numpy 2.5.4 / pytest 9.1.1）。
- mediapipe の stderr ノイズ（`WARNING: Logging before InitGoogle()`、XNNPACK、NORM_RECT 等）は benign。FastAPI `on_event is deprecated` 警告も benign。
- HTTPS APIプローブは PowerShell/curl ではなく Python で: `ssl._create_unverified_context()` + `urllib.request.urlopen("https://127.0.0.1:<port>/...")`（例 `.tmp/photos_root_check.py`）。
- サンドボックス（workspace-write）: 書き込みはリポジトリ直下のみ。pytest の `tmp_path` は PermissionError になるため **`ROOT/.tmp/` に uuid 名ファイル＋後片付け**が確立パターン。`vite build` は esbuild の named pipe で EPERM になることがあり、その場合のみ one-shot の権限エスカレーションで実行。
- `.tmp/` は検証用スクラッチ（gitignore）。`album_mode_check.py` / `photos_root_check.py` / `static_probe.py` は再実行可能な検証スクリプトとして残存（stale な `port_probe.py` は 2026-10-29 削除済み）。

## 8. 主要ファイル早見

| パス | 役割 |
|---|---|
| `PLAN.md` | 計画書＋変更履歴の正典（§2 変更履歴が最重要。約90KB） |
| `config.json` | port / photos_root / album_mode（コミット済み） |
| `server/app.py` | FastAPI エントリ・API・静的配信（`/photos`、`/`→web/dist） |
| `server/config.py` | `load_config()` と `album_for_rel()`（アルバムキー導出の単一実装） |
| `server/indexer.py` | 走査・差分再インデックス・サムネイル・顔検出実行・進捗 |
| `server/facedetect.py` | MediaPipe ラッパ（検出チェーン、`DETECT_VERSION`） |
| `server/db.py` | SQLite スキーマ（`photos`/`faces`）＋ヘルパー |
| `server/scale.py` | 原寸大スケール計算（mm/px・身長） |
| `server/tests/` | pytest 21件（test_config 16 / test_scale 5） |
| `web/src/xrGallery.ts` | VRギャラリー本体（約1100行、最重要ファイル） |
| `web/src/main.ts` / `gallery.ts` | 2Dページ |
| `web/src/settings.ts` | localStorage 設定（`fsvg.*` キー） |
| `web/vite.config.ts` | dev プロキシ（`../config.json` のポートを読む） |
| `models/*.task` | MediaPipe モデル（face_landmarker / pose_landmarker_full、オフライン同梱） |
| `scripts/` | run / start-server / build-web / setup-cert / setup / make-release / build-runtime / build-launcher / publish-github / facecheck / make_fixture |
| `tools/` | mkcert.exe、pyruntime\（配布用Pythonランタイム・gitignore）、launcher\fsvg.exe、ストレス写真生成・検証スクリプト |
