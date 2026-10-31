# サーバー起動: 同梱 runtime\python.exe（無ければ .venv）で HTTPS 起動
# ※ 通常は fsvg.exe（scripts\run.ps1）を使ってください。これは手動起動版です。
# ポート・写真ディレクトリ（photos_root）・アルバム定義（album_mode）・配信時ダウンスケールキャッシュ先（downscale_cache_dir）はリポジトリ直下の config.json（既定 8443 / Photos / 1 / data/downscale）。編集後は再起動で反映。
# 使い方: powershell -File scripts\start-server.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = $null
foreach ($c in @((Join-Path $root 'runtime\python.exe'), (Join-Path $root '.venv\Scripts\python.exe'))) {
    if (Test-Path $c) { $py = $c; break }
}
if (-not $py) {
    Write-Error "Python が見つかりません（runtime\python.exe / .venv\Scripts\python.exe）。zip 版は fsvg.exe を実行してください。"
    exit 1
}
Write-Output "python: $py"
& $py (Join-Path $root 'server\app.py')
