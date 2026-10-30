# オフライン配布用 Python ランタイムビルド（メンテナー用・zip には含めない）
# .venv のベース CPython と site-packages を tools\pyruntime\ に自己完結形で集約する。
# make-release.ps1 がこれを zip の runtime\ に同梱する。
# 使い方: powershell -File scripts\build-runtime.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $root 'tools\pyruntime'

# 既存ビルドの再利用（git SHA が一致すればスキップ）
$gitSha = ''
try {
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $gitSha = (& (Join-Path $root 'PortableGit\bin\git.exe') -C $root rev-parse HEAD) 2>$null | Select-Object -First 1
} finally { $ErrorActionPreference = $prevEAP }
$stamp = Join-Path $dst 'BUILD_STAMP.txt'
if ((Test-Path $stamp) -and -not $Force) {
    $old = Get-Content $stamp -TotalCount 1
    if ($old -eq $gitSha -and (Test-Path (Join-Path $dst 'python.exe'))) {
        Write-Output "ランタイムは既存を再利用: $dst （-Force で再ビルド）"
        exit 0
    }
}

# ベース CPython の特定（.venv\pyvenv.cfg の home）
$cfg = Get-Content (Join-Path $root '.venv\pyvenv.cfg') | ForEach-Object {
    if ($_ -match '^home\s*=\s*(.+)$') { $Matches[1].Trim() }
}
if (-not $cfg -or -not (Test-Path (Join-Path $cfg 'python.exe'))) {
    Write-Error "ベース CPython が見つかりません（.venv\pyvenv.cfg の home: $cfg）"
    exit 1
}
Write-Output "ベース CPython: $cfg"

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Force $dst | Out-Null

# 実行体・DLL・ライセンス
foreach ($f in @('python.exe', 'pythonw.exe', 'python3.dll', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt')) {
    $src = Join-Path $cfg $f
    if (Test-Path $src) { Copy-Item $src $dst }
}

# DLLs と Lib（不要ディレクトリ除外）
try {
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    robocopy (Join-Path $cfg 'DLLs') (Join-Path $dst 'DLLs') /E /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy DLLs failed ($LASTEXITCODE)" }
    robocopy (Join-Path $cfg 'Lib') (Join-Path $dst 'Lib') /E /NFL /NDL /NJH /NJS /XD site-packages __pycache__ idlelib ensurepip test | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy Lib failed ($LASTEXITCODE)" }
    robocopy (Join-Path $root '.venv\Lib\site-packages') (Join-Path $dst 'Lib\site-packages') /E /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy site-packages failed ($LASTEXITCODE)" }
} finally { $ErrorActionPreference = $prevEAP }

# 検証
& (Join-Path $dst 'python.exe') -c "import fastapi, uvicorn, PIL, mediapipe, numpy; print('runtime OK')"
if ($LASTEXITCODE -ne 0) { Write-Error 'ランタイム検証に失敗しました'; exit 1 }

Set-Content -Path $stamp -Value $gitSha -Encoding UTF8
Write-Output "ビルド完了: $dst"
