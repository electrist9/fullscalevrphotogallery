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
| Python | **3.12**（64-bit）。未導入なら [python.org](https://www.python.org/downloads/release/python-31214/) または `winget install -e --id Python.Python.3.12` |
| ディスク | アプリ自体 約 20MB ＋ 写真フォルダ ＋ キャッシュ約 20MB |

> Python 3.12 を推奨します（依存ライブラリを 3.12 対応版でピン留めしているため。3.11 以下・3.13 以上では依存のインストールが失敗する可能性があります）。

## 2. セットアップ（zip 版）

1. リリース zip（`fsvg-vX.Y.Z.zip`）を好きなフォルダに展開します（例: `C:\fsvg`）。
2. PowerShell でそのフォルダを開き、セットアップを 1 回だけ実行します:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
   ```

   - Python 3.12 を探して `.venv` を作成し、依存パッケージをインストールします（数分かかることがあります）。
   - HTTPS 証明書を自動生成します（mkcert は自動ダウンロード。PC の LAN IP を SAN に含みます）。
   - Web クライアントは zip にビルド済み同梱のため、通常ビルドはスキップされます。
3. サーバーを起動します:

   ```powershell
   powershell -File scripts\start-server.ps1
   ```

   起動後、バックグラウンドで写真フォルダのインデックス（顔検出込み）が始まります。写真 100 枚で数分程度が目安です（インデックス中も閲覧できますが、未処理の写真は原寸大になりません）。

### GitHub から clone する場合

```powershell
git clone https://github.com/<あなたのGitHubユーザー名>/fullscalevrphotogallery
cd fullscalevrphotogallery
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

clone 版にはビルド済み `web\dist` が含まれないため、`setup.ps1` が Node.js 22 を自動ダウンロードしてビルドします（初回は数分かかります）。

## 3. Quest 3 で開く

1. PC と**同じ Wi-Fi**に接続した Quest 3 のブラウザを開きます。
2. アドレスバーにサーバーの URL を入力します（`setup.ps1` / `start-server.ps1` が最後に表示します）:

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
| `setup.ps1` が Python 3.12 を見つけられない | `winget install -e --id Python.Python.3.12` で導入して再実行 |
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
```

- ソース構成・設計は GitHub リポジトリの `ARCHITECTURE.md` / `PLAN.md` 参照。
- 開発・検証は Quest 3 実機で行っています。

## ライセンス

MIT License（[LICENSE](LICENSE) 参照）。
