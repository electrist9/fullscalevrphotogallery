# fsvg.exe が呼ぶ起動エントリ（エンドユーザー向け・zip 同梱）
# 同梱 runtime\python.exe（なければ開発用 .venv）でサーバーを起動する。
# 初回は証明書がなければ自動生成（mkcert 同梱・オフライン可）。
# 手動起動: powershell -File scripts\run.ps1 ／ 自己診断のみ: -Check
param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Python の解決: 同梱ランタイム → 開発用 .venv
$py = $null
foreach ($c in @((Join-Path $root 'runtime\python.exe'), (Join-Path $root '.venv\Scripts\python.exe'))) {
    if (Test-Path $c) { $py = $c; break }
}
if (-not $py) {
    Write-Error 'Python ランタイムが見つかりません（runtime\python.exe / .venv\Scripts\python.exe）'
    exit 1
}
Write-Output "python: $py"

if ($Check) {
    & $py -c "import fastapi, uvicorn, PIL, mediapipe, numpy; print('imports OK')"
    if ($LASTEXITCODE -ne 0) { Write-Error '依存パッケージの読み込みに失敗'; exit 1 }
    Write-Output "certs\server.crt: $([bool](Test-Path (Join-Path $root 'certs\server.crt')))"
    Write-Output 'チェック OK'
    exit 0
}

# 初回実行: 証明書がなければ生成（mkcert 同梱のためオフラインで動く）
if (-not (Test-Path (Join-Path $root 'certs\server.crt'))) {
    Write-Output '初回起動です。LAN 用自己署名証明書を生成します...'
    try {
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & (Join-Path $root 'scripts\setup-cert.ps1')
    } finally { $ErrorActionPreference = $prevEAP }
    if (-not (Test-Path (Join-Path $root 'certs\server.crt'))) {
        Write-Error '証明書の生成に失敗しました。scripts\setup-cert.ps1 を直接実行して確認してください。'
        exit 1
    }
}

# ポート（config.json・既定 8443）と LAN IP 案内
$port = 8443
try {
    $cfgPath = Join-Path $root 'config.json'
    if (Test-Path $cfgPath) {
        $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $port = [int]$cfg.port }
    }
} catch { }
try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        ForEach-Object { $_.IPAddress })
} catch {
    $ips = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '127.*' -and $_.IPAddressToString -notlike '169.254.*' } |
        ForEach-Object { $_.IPAddressToString })
}
$ips = @($ips | Select-Object -Unique)
Write-Output ''
Write-Output 'Quest 3 のブラウザで次を開いてください（PC と Quest を同一 LAN に接続）:'
if ($ips.Count -eq 0) {
    Write-Output "  https://<PCのIP>:$port/  （PCのIPは「ipconfig」で確認）"
} else {
    $ips | ForEach-Object { Write-Output "  https://$_`:$port/" }
}
Write-Output '※証明書の警告が出たら「詳細情報」→「続行」を選択（自己署名のため）'
Write-Output '※停止するにはこのウィンドウを閉じるか Ctrl+C'
Write-Output ''
& $py (Join-Path $root 'server\app.py')
