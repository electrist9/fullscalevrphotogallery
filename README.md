# FullScale VR Photo Gallery

PC の写真フォルダを、**Meta Quest 3 のブラウザ（HMD 単体・PC リンク不要）** で見る Web アルバムアプリです。
特徴は **原寸大表示**。写真に写っている人の瞳間隔（IPD）を顔・虹彩検出で実測し、その人が VR 空間に「実際の身長で、目の高さに」表示されます。身長表示や床接地ガイドも自動です。

- サーバー: Windows PC 上で動く Python（HTTPS）。写真フォルダを自動インデックスし、顔検出・サムネイル生成。
- クライアント: Quest 3 の WebXR ブラウザ（`https://<PCのIP>:<ポート>/` を開くだけ。アプリインストール不要）。
- 通信は **自宅 LAN 内のみ**。インターネットには公開しません。

---

## 1. 動作環境

| 項目 | 条件 |
|---|---|
| PC | Windows 10/11（x64）。Quest 3 と**同一 Wi-Fi（LAN）**に接続 |
| HMD | Meta Quest 3（Quest 3 専用で検証しています） |
| Python | **不要**（zip にランタイムが同梱されています。インストールもダウンロードも不要です） |
| ディスク | 展開後 約 500MB（zip 約 200MB）＋ 写真フォルダ ＋ キャッシュ約 20MB |

> セットアップにはインターネット接続も不要です（証明書生成ツール mkcert も同梱済み）。

## 2. 使い方（zip 版）

1. リリース zip（`fsvg-vX.Y.Z.zip`）を好きな場所に展開します（例: `C:\` に展開すると `C:\fsvg-vX.Y.Z` フォルダができます）。
2. **`fsvg.exe` をダブルクリックするだけ**です。コンソールウィンドウが開き、サーバーが起動します。
   - 初回は LAN 用自己署名証明書が自動生成されます（オフラインで完了）。
   - ウィンドウ内に Quest 3 で開く URL（`https://<PCのIP>:8443/`）が表示されます。
   - サーバーの停止は、ウィンドウを閉じるか Ctrl+C。
   - 起動後、バックグラウンドで写真フォルダのインデックス（顔検出込み）が始まります。写真 100 枚で数分程度が目安です（インデックス中も閲覧できますが、未処理の写真は原寸大になりません）。

> **SmartScreen について**: 未署名の実行ファイルのため、初回起動時に「Windows が PC の保護をしました」と出ることがあります。「詳細情報」→「実行」を選択してください（出なければそのまま起動します）。
>
> **コマンドで起動する場合**: `powershell -ExecutionPolicy Bypass -File scripts\run.ps1`（`fsvg.exe` はこれを呼ぶだけのランチャーです）。

### GitHub から clone する場合（開発者向け）

```powershell
git clone https://github.com/electrist9/fullscalevrphotogallery
cd fullscalevrphotogallery
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

clone 版にはランタイムもビルド済み `web\dist` も含まれないため、`setup.ps1` が Python 3.12（要導入）と Node.js 22 を使って環境を作ります（インターネット必要・数分）。以降の起動は `powershell -File scripts\start-server.ps1`。

## 3. Quest 3 で開く

1. PC と**同じ Wi-Fi**に接続した Quest 3 のブラウザを開きます。
2. アドレスバーにサーバーの URL を入力します（`fsvg.exe` の起動ウィンドウに表示されます）:

   ```
   https://192.168.100.25:8443/     ← 例（PC の IP・ポートは環境による）
   ```

3. 「接続が安全ではありません」等の**証明書の警告**が出たら、「詳細情報」→「続行」を選択します。これは自己署名証明書によるもので、通信自体は暗号化されています。以後、ブックマークすれば警告を一画面スキップするだけで使えます。

### （任意・上級者向け）警告を完全に消す

Quest 側に mkcert のルート CA（`certs\caroot\rootCA.pem`）を信頼登録すると警告自体が消えます。このアプリ開発環境では未検証の一般手順ですが、Android 系の一般的な方法です:

- PC から ADB で: `adb install_ca_cert certs\caroot\rootCA.pem`（Quest の USB デバッグ有効化が必要）
- SideQuest の「Trust Server Certificates」機能で同ファイルを選択

いずれも失敗しても本アプリは動作します（警告続行で使えるため、無理にする必要はありません）。

## 4. 写真の追加・アルバム

- サーバーフォルダ内の `Photos\`（既定）が写真フォルダです。ここに jpg/png を置くか、サブフォルダで整理してください。
- **アルバム = フォルダ**です。`Photos\旅行2025\` はそのまま Quest 上のアルバム一覧に出ます。
- 追加・削除はサーバー起動中でも自動反映されます（起動時に差分スキャン。反映を待つかサーバーを再起動）。
- 写真フォルダを別の場所（外付け HDD など）にしたい場合は §5 の `photos_root` を変更します。

## 5. 設定（`config.json`）

アプリフォルダ直下の `config.json` を編集してサーバーを再起動すると反映されます（キーを消すと既定値に戻ります）。

```json
{
  "port": 8443,
  "photos_root": "Photos",
  "album_mode": 2
}
```

| キー | 既定 | 意味 |
|---|---|---|
| `port` | `8443` | HTTPS サーバーのポート。変更時は下のファイアウォール設定に注意 |
| `photos_root` | `Photos` | 写真フォルダ。アプリフォルダからの相対パス、または絶対パス（`"D:\\Pictures"` 等） |
| `album_mode` | `1` | アルバムの単位。`1` = 全フォルダ（サブフォルダも別アルバム）／`2` = 第一階層フォルダのみアルバム（サブフォルダ内の写真は親アルバムにまとまる） |

### ポートを変更した場合（8443 以外）

Windows ファイアウォールでそのポートへの受信許可を追加する必要があります。**管理者権限**の PowerShell で:

```powershell
netsh advfirewall firewall add rule name="FSVR Gallery <ポート>" dir=in action=allow protocol=TCP localport=<ポート>
```

（既定の 8443 の場合は、過去の起動で既に許可されていることが多く、追加不要なことが多いです。Quest から繋がらないときだけ実行してください。）

## 6. トラブルシューティング

| 症状 | 対処 |
|---|---|
| Quest からページが開けない | サーバー起動中か／PC と Quest が同一 Wi-Fi か／PC の IP を確認。PC の IP が変わったら `powershell -File scripts\setup-cert.ps1` で証明書を再生成（IP を SAN に再含め）→ サーバー再起動 |
| `fsvg.exe` が起動しない | SmartScreen で「詳細情報」→「実行」。antivirus にブロックされていないか確認。または `powershell -ExecutionPolicy Bypass -File scripts\run.ps1` でエラーメッセージを確認 |
| 写真が「原寸大」にならない | その写真の顔検出が未完了/失敗。インデックス完了を待つ、または写っている人の顔がはっきり分かる写真か確認 |
| 表示が重い | 詳細は開発者向けドキュメント参照（通常は Quest 3 で快適に動作するよう調整済み） |
| 証明書の警告が烦わしい | §3 の「任意」の CA 信頼登録、またはそのまま「続行」で利用 |

## 7. セキュリティ上の注意

- このアプリは**認証なし**で、**LAN 内の誰でも**写真を見られる設計です（自宅内で家族と共有する前提）。
- **ルーターでポートフォワード（インターネット公開）は絶対にしないでください。**
- 証明書・CA・写真・データベース（`certs/` `data/` `Photos/`）は git にも zip にも含まれません。

## 8. 開発者向け

```powershell
powershell -File scripts\build-web.ps1    # Web クライアントのビルド（tools\node 使用・自動 DL）
.venv\Scripts\python.exe -m pytest server\tests -q   # サーバーのテスト
powershell -File scripts\build-runtime.ps1  # 配布用 Python ランタイムのビルド（tools\pyruntime）
powershell -File scripts\build-launcher.ps1 # fsvg.exe ランチャーのビルド（csc.exe 使用）
powershell -File scripts\make-release.ps1   # 配布 zip 生成（runtime/fsvg.exe 同梱）
```

- ソース構成・設計は GitHub リポジトリの `ARCHITECTURE.md` / `PLAN.md` 参照。
- 開発・検証は Quest 3 実機で行っています。

## ライセンス

MIT License（[LICENSE](LICENSE) 参照）。
