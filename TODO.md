# TODO.md — 残作業・未決事項

> 最終更新: 2026-10-30（**M4 完了・GitHub 公開済み**・`main`）。完了済み項目は PLAN.md §2 変更履歴と PROJECT_STATE.md §2 を参照（这里是「やっていないこと」だけ）。

## 1. M4「品質・配布」（進行中・次のマイルストーン）

PLAN.md §7 の M4 完了条件: **「初回セットアップ30分以内で動く」**。
**配布方針（2026-10-29 ユーザー決定）**: セルフホスト配布（LAN限定・認証なしの stance 不変。インターネット公開は対象外）。チャネルは **GitHubリポジトリ＋zipパッケージ** の両方。ライセンス **MIT**。README **日本語のみ**。**配布形式変更（2026-10-30 ユーザー決定）**: zip に **Python ランタイムと fsvg.exe を同梱**し、「**展開して fsvg.exe を実行するだけ**（インターネットオフラインでセットアップ完結）」。Python 導入は不要になった。

- [x] 公開前掃除（`Photos/_stress/` 削除・webxr-test 遺物削除・stale修正・テスト修正）→ `bc4a071` で完了。
- [x] **`scripts/setup.ps1` 実装**（初回セットアップ自動化）→ feature/m4-distribution で完了。Python 3.12 検出（`py -3.12`→`python -V`、無ければ案内）、`.venv` 作成、`pip install --disable-pip-version-check`、`setup-cert.ps1` 実行、`web/dist` 無ければ Node 自動DL→ビルド。スモークテスト済み（冪等経路 exit 0）。
- [x] **README.md 作成**（新規ユーザー向けセットアップ手順・日本語）→ feature/m4-distribution で完了。一次手順は**警告の「詳細情報」→「続行」**（実運用で確認済み。ユーザーが CA 未インストールと判明したため方針変更）。CA 信頼登録は任意・未検証の代替として併記。config.json 3キー・ファイアウォール・トラブルシューティング・セキュリティ注意含む。
- [x] **LICENSE（MIT）作成** → © 2026 FullScale VR Photo Gallery contributors。
- [x] **`scripts/make-release.ps1` 実装**（スリムzip生成）→ feature/m4-distribution で完了。git追跡ファイル＋ビルド済み `web/dist`、内部ドキュメント（PLAN/PROJECT_STATE/ARCHITECTURE/DECISIONS/TODO）除外。テスト実行 OK（`release/fsvg-v0.9.0.zip` 11.3MB）。
- [x] セットアップ手順の実測（まっさらな環境で30分以内の確認）→ **サンドボックス環境では測定不可**（2026-10-29 ユーザー決定でスキップ）。新規テスト（zip展開→setup.ps1）は Python 3.12 検出まで OK（`1b1cbd8` の EAP対策で解消）だが、`python -m venv` の ensurepip が harness サンドボックスの一時フォルダ書き込み拒否で失敗（`tempfile.mkdtemp` 配下のフォルダにサインインユーザー本人の権限項目が付かない。ACL診断レポート: `.tmp/acl-out/`）。setup.ps1 の欠陥ではなく、実ユーザーマシン（TEMP 書き込み可）では成功する見込み。
- [x] 受け入れ基準 §9-3 の正式検証: **キャリブレーション人物基準で原寸大の身長表示誤差 ±5%以内** → **PASS（2026-10-30、3/3・最大誤差 +1.24%）**。実測（Quest 3 実機・IPD 63mm 設定＝デフォルト一致、ユーザー報告。サーバー側 `/api/photos` の値と pupil_px 完全一致を確認済み、method=top50）:
  - `Photos/calib/1.png`: 実測 161cm → 表示 1.63m（pupil_px 231.7・server height_mm 1630.7）誤差 **+1.24%**
  - `Photos/calib/2.png`: 実測 158cm → 表示 1.58m（pupil_px 210.8・server height_mm 1583.5）誤差 **0.00%**
  - `Photos/calib/3.png`: 実測 164cm → 表示 1.65m（pupil_px 222.5・server height_mm 1652.7）誤差 **+0.61%**
- [x] **オフライン配布形式（2026-10-30 ユーザー要望）**: zip 展開→`fsvg.exe` ダブルクリックだけで起動（Python 不要・オフライン可）→ `feature/offline-dist` で完了。`build-runtime.ps1`（tools\pyruntime 406MB・import検証OK）／`launcher.cs`+`build-launcher.ps1`（csc.exe→fsvg.exe）／`run.ps1`（runtime\python.exe 解決・初回証明書自動生成・Quest URL表示・`-Check`）／`make-release.ps1` 改修（runtime・fsvg.exe・mkcert.exe 同梱）／`setup.ps1`・`start-server.ps1`・README 更新。**zip 160.4MB**（従来 11.3MB。GitHub Release 上限 2GB 内）。
- [x] GitHub リポジトリ作成・push・Release に zip 添付（**2026-10-30 ユーザーが手動実施完了**: `https://github.com/electrist9/fullscalevrphotogallery` に main（`1cd8519`）push ＋ Release `v0.9.0` に `release\fsvg-v0.9.0.zip`（160.4MB・オフライン配布形式）添付済み。`scripts/publish-github.ps1` は未使用でリポジトリに残置）。
- 備考: 性能予算（PLAN §7）のテクスチャ/LRU 対策は M3 で実装済み（LRU 48・ウィンドウ生成・1000枚実機OK）。差分インデックスも前倒し済み。M4 で残るのは主にドキュメント・配布自動化と正式検証。

## 2. 未決事項（PLAN.md §10 で唯一未決 — ユーザーの決定待ち）

- [ ] **ギャラリーの空間デザイン: 白いギャラリー部屋 vs 無限グリッド**。**別ブランチで実装中（2026-10-30）**。現状は無限グリッド（y=0.001）。`web/src/xrGallery.ts` の床・背景まわり。実機確認ゲート必須。

## 3. 精度・原寸大の精緻化（PLAN §4.3 の既知の限界。優先度低・要望があれば）

- [ ] 深度平面以外の遠近ズレ（体・背景が原寸からずれる）— 現状は顔基準で正直に限界明記。抜本対策は §5 の EXIF 焦点距離補正（M5）。
- [ ] メガネ・コンタクト・閉眼時の虹彩精度低下 → 信頼度で吸収中。改善余地があれば検出チェーン拡張（`DETECT_VERSION` バンプ必須、差分再検出が走る）。
- [ ] 原寸体感テストの体系化（PLAN §4.4: 距離Dに立った実物と身長が一致するかの確認手順）。

## 4. M5 拡張（PLAN §7/§10/§11）

### M5-1 疑似ステレオ表示（設計確定 2026-10-30・PLAN §11。実装未着手）

**決定**: Depth Anything V2 Small (ONNX/CPU)＋DIBR水平シフト＋SBSパーイテクスチャ。遅延生成（初回VR表示トリガー）。原寸大維持。

- [ ] M5-1a 深度推定PoC: ONNXモデル統合、`server/stereo.py` 実装、深度マップ生成確認
- [ ] M5-1b DIBR合成: 水平シフト＋穴埋め、SBS画像生成、PCで立体確認
- [ ] M5-1c サーバー統合: DB列追加（stereo_status/stereo_ver）、API（POST generate / GET stereo）、遅延生成フロー
- [ ] M5-1d クライアント統合: ShaderMaterial パーイテクスチャ、生成トリガー、ポーリング切替
- [ ] M5-1e 品質調整: 視差量チューニング、穴埋め品質、性能予算確認、Quest 3 実機検証
- [ ] `requirements.txt` に `onnxruntime` 追加
- [ ] `scripts/download-model.ps1`（Depth Anything V2 Small ONNX DL）
- [ ] `models/depth_anything_v2_small.onnx` 配置（~100MB）
- [ ] `data/stereo/` を .gitignore に追加
- [ ] pyruntime への onnxruntime 同梱検証（オフライン配布対応）

### M5-2 以降（未設計・要望があれば）

- [ ] 実ステレオペア（2枚撮影）表示
- [ ] お気に入り
（いずれも着手前にユーザーと要件確認すること。実装時は確立ワークフローに従う）

**やらない決定（2026-10-30）**: EXIF焦点距離による深度補正（写真のほとんどにEXIFが無い）、動画（本アプリのコンセプトから外れる）。

## 5. 掃除・.housekeeping（動作影響なし、見つけたときに）

- [ ] `.gitignore` の `Photos/` は photos_root をリポジトリ外へ移した場合に効かない。photos_root がリポジトリ内の別名ディレクトリのときは gitignore 追加が必要（運用で吸収可）。
- [ ] FastAPI `on_event` 非推奨警告（benign）: 将来の FastAPI 更新で消える可能性あり。そのときは `lifespan` へ移行。

（2026-10-29 公開前掃除で完了済み: `Photos/_stress/` 1000枚削除＋DB除去／`webxr-test/`・`scripts/webxr-test-server.mjs` git削除／`.tmp/port_probe.py` 削除／状態記録4ファイルは main にコミット済み `ba2546b`）

## 6. 明示的に「やらない」と決まっていること（再検討しない）

- テレポート・ビネット（2026-10-26 決定）／ HEIC 対応（2026-10-28）／ 認証・PIN（2026-10-28）／ 床接地ガイド帯（2026-10-29 削除済み）／ フィット⇄原寸大の即時トグル（2026-10-26 廃止）／ 3段グリッド・ページング（2026-10-28 廃止）。
- 詳細は DECISIONS.md 参照。ユーザーから同じ要望が出たら決定を見直す。
