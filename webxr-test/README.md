# WebXR HTTPS 事前検証（推奨A: mkcert + LAN HTTPS）

本実装（M0）の前に、「mkcert 証明書 + LAN 内 HTTPS で Questブラウザの WebXR が本当に動くか」を検証する最小セット。

## 構成

| ファイル | 役割 |
|---|---|
| `tools/mkcert.exe` | ローカルCA・証明書生成ツール (v1.4.4) |
| `certs/server.crt` / `certs/server.key` | サーバ証明書（SAN: `192.168.100.25`, `localhost`, `127.0.0.1`, `::1`） |
| `certs/caroot/rootCA.pem` | ルートCA（Quest側に信頼させるファイル。秘密鍵 `rootCA-key.pem` はPC外に出さない） |
| `scripts/webxr-test-server.mjs` | HTTPS テストサーバ（ポート 8443） |
| `scripts/setup-cert.ps1` | IP変更時などの証明書再生成 |
| `webxr-test/index.html` | 検証ページ（診断 + immersive-vr セッションテスト） |

## PC側: サーバ起動

```powershell
node scripts\webxr-test-server.mjs
# → https://192.168.100.25:8443/ と表示される
```

PC側での疎通確認は完了済み（localhost / 127.0.0.1 / 192.168.100.25 すべて HTTP 200、TLSハンドシェイク OK）。

## PC側: ファイアウォール（初回のみ・管理者ターミナルで1回）

Questからの受信を許可するルール。管理者権限で開いた PowerShell で:

```powershell
netsh advfirewall firewall add rule name="FSVR WebXR Test 8443" dir=in action=allow protocol=TCP localport=8443
```

検証終了後の削除:

```powershell
netsh advfirewall firewall delete rule name="FSVR WebXR Test 8443"
```

## Quest側: 検証手順

1. Questブラウザで `https://192.168.100.25:8443/` を開く
2. 証明書警告が出るので「詳細情報」→「続行」で許可する（推奨Aの「警告を許可」経路）
3. ページ上部の診断リストを確認:
   - `isSecureContext: true`
   - `navigator.xr: true`
   - `isSessionSupported(immersive-vr): true`
4. 「immersive-vr セッション開始」ボタンを押す（コントローラのトリガーでクリック）
5. VR内で青い背景が描画され、約120フレーム後に自動でVRを抜ける
6. ページに **「✅ 検証成功」** が表示されれば合格

## 任意: 警告を出さない（ルートCAを信頼させる）

QuestにルートCAをインストールすると警告ページが消える。SideQuest PC版の「Install certificate」機能で `certs\caroot\rootCA.pem` をQuestに登録できる（非root Quest 2/3で動作）。未導入でも「警告→続行」で検証は可能。

## 比較: 推奨B（adb reverse）

同じページが `adb reverse tcp:8443 tcp:8443` 後に Quest の `https://localhost:8443/` でも動くことを確認しておくと、B案の保険も検証できる（警告なしでセキュアコンテキストになるはず）。

## 結果記録（検証後に記入）

| 項目 | 結果 | 備考 |
|---|---|---|
| PC側 HTTPS 疎通 (HTTP 200) | ✅ 2026-10-24 | localhost / 127.0.0.1 / 192.168.100.25 |
| Quest: 警告→続行でページ表示 | ✅ 2026-10-24 | Quest 3 ブラウザ、`https://192.168.100.25:8443/` |
| Quest: isSecureContext / navigator.xr | ✅ 2026-10-24 | セッション開始成功により暗黙確認 |
| Quest: immersive-vr セッション + 120フレーム | ✅ 2026-10-24 | immersive モード進入を確認 |
| (任意) SideQuest CA導入で警告なし | ☐ | |
| (任意) adb reverse + https://localhost | ☐ | |
