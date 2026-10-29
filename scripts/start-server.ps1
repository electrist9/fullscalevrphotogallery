# サーバー起動: workspace内 .venv の python で HTTPS 起動
# ポートと写真ディレクトリ（photos_root）はリポジトリ直下の config.json（既定 8443 / Photos）。編集後は再起動で反映。
# 使い方: powershell -File scripts\start-server.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Error "venv が見つかりません: $py （先に .venv を作成してください）"
    exit 1
}
Write-Output "python: $py"
& $py (Join-Path $root 'server\app.py')
