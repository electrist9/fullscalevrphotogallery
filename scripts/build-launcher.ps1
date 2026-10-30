# fsvg.exe（ランチャー exe）のビルド（メンテナー用・zip には含めない）
# .NET Framework 4 の csc.exe で scripts\launcher.cs をコンパイルし tools\launcher\fsvg.exe に出力。
# 使い方: powershell -File scripts\build-launcher.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    Write-Error 'csc.exe が見つかりません（.NET Framework 4 が必要です）'
    exit 1
}
$out = Join-Path $root 'tools\launcher\fsvg.exe'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
try {
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $csc /nologo /target:exe /out:$out (Join-Path $root 'scripts\launcher.cs')
} finally { $ErrorActionPreference = $prevEAP }
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) {
    Write-Error 'fsvg.exe のビルドに失敗しました'
    exit 1
}
Write-Output "ビルド完了: $out"
