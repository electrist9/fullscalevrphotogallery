# web ビルド: workspace内 Node/pnpm を使って pnpm install + vite build
# 使い方: powershell -File scripts\build-web.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root 'tools\node\node.exe'
$pnpm = Join-Path $root 'tools\node\node_modules\pnpm\bin\pnpm.cjs'
if (-not (Test-Path $node)) { Write-Error "Node が見つかりません: $node"; exit 1 }
$env:PATH = (Join-Path $root 'tools\node') + ';' + $env:PATH
$env:CI = 'true'
Push-Location (Join-Path $root 'web')
try {
    & $node $pnpm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $node $pnpm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
