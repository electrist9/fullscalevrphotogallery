# 証明書再生成スクリプト (推奨A: mkcert)
# PC の LAN IP が変わったときなどに、管理者権限なしで通常実行してください。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$mkcert = Join-Path $root 'tools\mkcert.exe'
if (-not (Test-Path $mkcert)) {
  New-Item -ItemType Directory -Force (Join-Path $root 'tools') | Out-Null
  Write-Host 'mkcert をダウンロードします...'
  Invoke-WebRequest -Uri 'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe' -OutFile $mkcert -UseBasicParsing
}

$ips = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' }).IPAddress
Write-Host "LAN IP 候補: $($ips -join ', ')"

$env:CAROOT = Join-Path $root 'certs\caroot'
$sans = @('localhost', '127.0.0.1', '::1') + $ips
& $mkcert -cert-file certs\server.crt -key-file certs\server.key @sans

Write-Host ''
Write-Host '生成物: certs\server.crt / certs\server.key'
Write-Host 'ルートCA (Quest側に信頼させるファイル): certs\caroot\rootCA.pem'
Write-Host 'サーバ起動: powershell -File scripts\start-server.ps1'
