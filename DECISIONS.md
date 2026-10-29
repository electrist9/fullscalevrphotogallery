# DECISIONS.md — 設計・運用の決定記録

> 最終更新: 2026-10-29。各決定は確定済みのもの（実機確認またはユーザー合意済み）。状態は PROJECT_STATE.md、残作業は TODO.md。履歴の正典は PLAN.md §2 変更履歴。

## A. アーキテクチャ・基盤

### A1. HMD単体（Questブラウザ）＋PCサーバー、PCリンク（ALOS/Link）は使わない
- 理由: 「Questだけで見る」ことが要件。WebXR `immersive-vr` は Questブラウザで動作検証済み（2026-10-24 事前検証 `webxr-test/` 合格）。ネイティブアプリを作らない。
- 帰結: HTTPS必須（secure context）、配信は LAN WiFi、メモリ上限が厳しいため LRU/ウィンドウ生成設計（A7）。

### A2. サーバーは Python（FastAPI + Uvicorn）、Nodeではない
- 理由: 顔検出が MediaPipe（Python）必須。インデックス・配信・検出を1プロセスに統合でき、セットアップが単純（`.venv` + `requirements.txt`）。
- 代替案: Nodeサーバー＋Pythonワーカー分離 → 運用复杂度増で却下。

### A3. HTTPS は mkcert ローカルCA＋LAN IP証明書（certs/、gitignore）
- 理由: WebXRはHTTPS必須。自己署名だと Quest で警告回避が困難。mkcert CA を Quest に一度入れれば以後警告なし。証明書は SAN=IP/localhost のみで**ポート非依存**（port 変更で再生成不要）。
- スクリプト: `scripts/setup-cert.ps1`（`tools/mkcert.exe`）。

### A4. DB は SQLite 単一ファイル（data/app.db）、サムネイルは DB BLOB 主配信
- 理由: 単一PC・ゼロ設定。1000枚規模で十分。`/thumbs/{pid}` で BLOB 配信（ファイル配信より一貫性が高い）。`data/thumbs/` は歴史的残存。
- 帰結: `photos.relpath` が一意キー。削除は `ON DELETE CASCADE`。

### A5. workspace 自己完結環境（PortableGit / tools/node / .venv / models 同梱）
- 理由: セットアップ30分以内（M4 完了条件）と再現性。git・Node・Python・MediaPipeモデル（`models/*.task`）をすべてリポジトリ直下に同梱し、ネットワーク導入を最小化。
- 注意: git は PATH に無い → **必ず `& PortableGit\bin\git.exe`**。

## B. 原寸大（本命機能）

### B1. スケール基準は「虹彩468/473の瞳間隔 px × 実IPD mm」
- 理由: 虹彩は個人差が小さく測距安定。FaceLandmarker refineLandmarks に虹彩ランドマークが内蔵。実IPDは既定63mm＋XR設定パネルで上書き可（決定 2026-10-24）。
- 数学: mm/px = IPD実測 ÷ pupil_px。身長 = (sole_y − crown_y) × mm/px。`server/scale.py` + `test_scale.py`（キャリブ写真、誤差目標 <5%）。
- 既知の限界（PLAN §4.3、M4/M5候補）: スケールは**被写体の深度平面**基準。遠近で体・背景はズレる（顔は正確）。メガネ・閉眼で虹彩精度低下。EXIF焦点距離補正は M5+ 拡張。

### B2. 顔検出チェーン v2（DETECT_VERSION=2）: full → crop → 3×3 tile → posecrop
- 理由: 実機で遠景・小顔・横顔の取りこぼし指摘（2026-10-28）。段階的ズームで救い、最初の成功で確定。Pose（`pose_landmarker_full`, num_poses=1）は足先 sole_y・hip・鼻位置を提供。
- 運用ルール: **検出戦略を変えたら `facedetect.DETECT_VERSION` を上げる**。差分再スキャンが detect_ver 不一致の写真だけ再検出する。

### B3. 詳細表示は3モード固定（開いた時点で決定、トグル無し）
- 全身（sole_y 床接地）／半身（画像内目を `eyeLifeM` 既定1.45m に固定）／フィット（最大辺2.2m）。顔認識できなければフィットへフォールバック。
- 履歴: フィット⇄原寸大トグルは 2026-10-26 廃止。半身の目の高さ 1.45m は実機指摘（1.55m は高い）で 2026-10-26 調整、パネルで 1.0–2.0m 可変。
- 全身で画像が床下に余る分は**床折り曲げストリップ**（手前へ延ばす）で表示（2026-10-28 実機「極めて良好」）。床グリッドとは y=0.001/0.002 の高さ分離で Z-fighting 回避（2026-10-29）。
- 床接地ガイド帯（青い四角）は**完全削除**（2026-10-29 実機指摘: 折り目・写真下端で接地は十分視認でき、v2検出でガイドの必要性が低下）。

### B4. 表示距離は3モード個別設定（0.5–5.0m、既定 全身1.0/半身1.0/フィット2.4）
- 理由: 実機で「近すぎる/遠すぎる」要望に応える（2026-10-28）。アンカー root は床 y=0 頭基準、写真距離は photoGroup オフセットで実現。

## C. ギャラリーUX

### C1. 1段アーク（R=3.4, ROW_Y=1.3）＋右スティック連続スクロール（2026-10-28）
- 理由: 旧3段グリッド＋ページングは実機で「操作しづらい」。1段化＋連続スクロール（既定1.2 rad/s、0.4–3.0 可変）へ置換。1000枚で「非常に快適」（実機確認）。
- 実装: ウィンドウ生成＋テクスチャ LRU 48。隙間は目隠しメッシュ（galleryBand/albumBand）。ページング UI（PAGE_MAX 等）は削除済み。

### C2. アルバムはサムネイルチップ行（ギャラリー上部 y=1.80、連続スクロール）
- 理由: 実機で「アルバムを視覚的に選びたい」。各アルバムの先頭写真（ORDER BY relpath）サム＋12字省略名。旧2段目グリッドUIは置換。
- 修正履歴: サムは高さ基準で**アスペクト比常に正確**（幅クランプによる縦圧縮を実機指摘で廃止、2026-10-28）。先頭に「すべて (N)」疑似チップ。
- 2Dページのアルバム選択は VR 開始時に引き継がれる（2026-10-28）。

### C3. VR退出は 🚪 ボタン（⚙ の右、案A）
- 理由: HMD内から出られない問題への最小解（2026-10-28 実機）。

### C4. 情報パネルはデフォルト非表示＋Xボタン トグル
- 理由: 実機で「写真に集中したい」。Quest 3 に物理Yボタンが無いので Y 代替として X（2026-10-26）。トリガー=選択→詳細、戻る=閉じる（グリップ操作は廃止）。

### C5. テレポート・ビネット（快適性機能）は実装しない（2026-10-26）
- 理由: 連続スクロール＋座って見る設計で酔い報告なし。実装コストに見合わない。

## D. 設定・構成

### D1. 設定GUIは作らない。`config.json`（テキスト編集）＋サーバー再起動で反映
- 理由: ユーザー要望（2026-10-29、port 可変化時）。サーバー側設定はすべて `server/config.py` の `load_config()` 経由。
- 共通パターン: 不正値は**日本語警告 print＋既定フォールバック**（壊れJSON・型不正・範囲外すべて安全側に）。テストは `server/tests/test_config.py`。ドキュメントは `start-server.ps1` 冒頭コメント。
- 既存キー: `port`（既定8443）/ `photos_root`（既定 Photos、相対=ROOT基準、絶対可、自動作成）/ `album_mode`（既定1）。
- 注意: 設定は**モジュール import 時に一度だけ読む** → 反映には再起動必須（意図した仕様）。

### D2. `album_mode` でアルバム単位定義を切り替え（2026-10-29、現運用値は 2）
- mode 1 = 全ディレクトリ/サブディレクトリを別アルバム（従来動作・既定）。mode 2 = 第一階層ディレクトリのみアルバム（第二階層以下もそのアルバムに含む）。
- 決定ポイント:
  - 導出関数 `album_for_rel()` は **config.py に置く**（indexer→mediapipe を import せずにテストできるため）。
  - モード切替の DB 同期は**album 列だけ UPDATE**（差分スキャンのスキップ分岐で保存値と比較）。顔再検出はしない → 1000枚で数秒。force 再インデックスでは index_photo が普通に書き直す。
  - API・クライアントはアルバム文字列を汎用処理 → **サーバーのみ変更、web 再ビルド不要**。

### D3. photos_root 変更時はフル再構築（約35秒/1000枚）
- 理由: relpath が photos_root 相対キーのため、ルートを換えると差分判定が全滅→実質フル再スキャン。許容範囲（実測）なので差分最適化はしない。`reindex_all` が消えた行を削除するので整合は保たれる。

### D4. HEIC 対応はしない（2026-10-28）
- 理由: 利用頻度が極めて低い。Quest Browser（Chromium）は HEIF/HEIC 非サポートで、対応するならサーバー側二重変換（サム＋フル）が必要。`SUPPORTED` に含めず、HEIC はスキャン対象外（無視）の現状を据え置き。

### D5. 認証（PIN等）は設けない（2026-10-28）
- 理由: 自宅LAN内個人利用のみ。HTTPS は WebXR 要件であって認証目的ではない。

## E. 開発プロセス・品質

### E1. 機能ごとの確立ワークフロー（ブランチ→PC検証→**ユーザー実機確認ゲート**→PLAN.md更新→`--no-ff` マージ→ブランチ削除）
- 理由: 実機（Quest 3）でしか分からない知見が多い（見え方・操作感・酔い）。ユーザーが実機で OK と言うまで PLAN.md は「実機確認待ち」のまま。PLAN.md 変更履歴に「**Quest 3 実機確認（日付、OK）**: ①…②…」の項目記録を残す慣習。
- マージは `--no-ff`（機能単位で履歴に残す）。ブランチはマージ後削除。

### E2. テストは pytest、一時ファイルは `ROOT/.tmp/`（`tmp_path` fixture は使わない）
- 理由: DSH サンドボックス（workspace-write）では pytest の `tmp_path`（システムTemp）が PermissionError になる確立回避策。uuid 名ファイル＋後片付け。DB を触る検証は `db.DB_PATH` を monkeypatch（実 DB を壊さない）。
- 現状: 21 passed（test_config 16 / test_scale 5）。`test_scale.py` は実 `Photos/` のキャリブ写真を使うため **PHOTOS パスは既定 Photos のまま**（photos_root 設定に連動させない）。

### E3. HTTPS APIプローブは Python（ssl unverified context）
- 理由: WinPS 5.1 の `Invoke-WebRequest -SkipCertificateCheck` 非対応、`curl.exe -k` は schannel で SEC_E_NO_CREDENTIALS。確立パターン: `ssl._create_unverified_context()` + `urllib.request.urlopen("https://127.0.0.1:<port>/...")`（例 `.tmp/photos_root_check.py`）。

### E4. 負荷テストは生成写真1000枚（`tools/_make_stress_photos.py` → `Photos/_stress/`）
- 理由: 1000枚規模の性能・スクロール快適性を実機で検証するため（2026-10-26〜28、合格）。**現在も Photos/_stress に1000枚残存中**（整理は TODO 参照）。

### E5. 検証用キャリブレーション画像は `scripts/make_fixture.py` で生成（`calibration*` はインデックス除外）
- 理由: 既知IPDの合成写真で pupil_px 誤差・スケールを回帰テスト可能に。indexer は `calibration*` を明示除外しているので Photos/ 直下に置いてもギャラリーに混ざらない。
