# FullScale VR Photo Gallery 初回セットアップスクリプト
# zip を展開（または GitHub から clone）した後、最初に一度だけ実行してください。
#   1. Python 3.12 を探す（無ければ導入を案内して終了）
#   2. .venv を作成し requirements.txt の依存を導入
#   3. HTTPS 証明書を生成（scripts\setup-cert.ps1。mkcert は自動ダウンロード）
#   4. web\dist が無い場合のみ Web クライアントをビルド（zip 版は同梱済みのため通常スキップ。
#      Node が無い場合は Node 22 を自動ダウンロード）
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '=== FullScale VR Photo Gallery セットアップ ==='
Write-Host ''

# ---- 1. Python 3.12 を探す ----
function Find-Python312 {
    # py ランチャー（Windows 標準インストーラーが入れる）を優先
    if (Get-Command py.exe -ErrorAction SilentlyContinue) {
        $v = & py -3.12 -V 2>$null
        if ($LASTEXITCODE -eq 0 -and "$v" -match 'Python 3\.12') {
            return @{ Cmd = 'py'; Args = @('-3.12') }
        }
    }
    if (Get-Command python.exe -ErrorAction SilentlyContinue) {
        $v = & python -V 2>$null
        if ("$v" -match 'Python 3\.12') {
            return @{ Cmd = 'python'; Args = @() }
        }
    }
    return $null
}

$pyExe = Join-Path $root '.venv\Scripts\python.exe'
if (Test-Path $pyExe) {
    Write-Host '.venv は既に存在します（スキップ）'
} else {
    $py = Find-Python312
    if (-not $py) {
        Write-Error @'
Python 3.12 が見つかりません。
  1. https://www.python.org/downloads/release/python-31214/ から Python 3.12（Windows installer 64-bit）をインストールするか、
  2. PowerShell（管理者不要）で:  winget install -e --id Python.Python.3.12
インストール後、このスクリプトを再実行してください。
（3.12 対応の依存ライブラリをピン留めしているため 3.12 を推奨します）
'@
        exit 1
    }
    Write-Host "Python 3.12 を使用: $($py.Cmd) $($py.Args -join ' ')"
    & $py.Cmd @($py.Args + @('-m', 'venv', '.venv'))
    if ($LASTEXITCODE -ne 0) { Write-Error '.venv の作成に失敗しました'; exit 1 }
    $pyExe = Join-Path $root '.venv\Scripts\python.exe'
}

# ---- 2. 依存パッケージの導入 ----
Write-Host ''
Write-Host '依存パッケージをインストールします（数分かかります）...'
& $pyExe -m pip install --quiet --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Error 'pip install に失敗しました。ネットワークを確認して再実行してください。'; exit 1 }
Write-Host '依存パッケージの導入完了'

# ---- 3. HTTPS 証明書生成 ----
Write-Host ''
Write-Host 'HTTPS 証明書を生成します...'
& (Join-Path $PSScriptRoot 'setup-cert.ps1')
if ($LASTEXITCODE -ne 0) { Write-Error '証明書生成に失敗しました'; exit 1 }

# ---- 4. Web クライアント（zip 版は web\dist 同梱済み。無いときのみビルド） ----
$distIndex = Join-Path $root 'web\dist\index.html'
if (Test-Path $distIndex) {
    Write-Host ''
    Write-Host 'web\dist は既に存在します（スキップ）'
} else {
    Write-Host ''
    Write-Host 'web\dist が無いため Web クライアントをビルドします...'
    $node = Join-Path $root 'tools\node\node.exe'
    if (-not (Test-Path $node)) {
        Write-Host 'Node.js 22 をダウンロードします（数分かかります）...'
        $nodeVer = 'v22.23.4'
        $zipPath = Join-Path $root 'tools\node-win-x64.zip'
        New-Item -ItemType Directory -Force (Join-Path $root 'tools') | Out-Null
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" -OutFile $zipPath -UseBasicParsing
        $tmp = Join-Path $root 'tools\node-extract'
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $tmp
        Move-Item (Join-Path $tmp "node-$nodeVer-win-x64") (Join-Path $root 'tools\node')
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        $node = Join-Path $root 'tools\node\node.exe'
        if (-not (Test-Path $node)) { Write-Error 'Node.js の展開に失敗しました'; exit 1 }
    }
    # pnpm は同梱版があればそれ、無ければ corepack 経由で取得（lockfileVersion 9 互換の 10 系）
    $pnpmLocal = Join-Path $root 'tools\node\node_modules\pnpm\bin\pnpm.cjs'
    Push-Location (Join-Path $root 'web')
    try {
        if (Test-Path $pnpmLocal) {
            & $node $pnpmLocal install
            if ($LASTEXITCODE -ne 0) { Write-Error 'pnpm install に失敗しました'; exit 1 }
            & $node $pnpmLocal run build
            if ($LASTEXITCODE -ne 0) { Write-Error 'vite build に失敗しました'; exit 1 }
        } else {
            $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
            $corepack = Join-Path $root 'tools\node\node_modules\corepack\dist\corepack.js'
            & $node $corepack pnpm@10.34.8 install
            if ($LASTEXITCODE -ne 0) { Write-Error 'pnpm install（corepack）に失敗しました'; exit 1 }
            & $node $corepack pnpm@10.34.8 run build
            if ($LASTEXITCODE -ne 0) { Write-Error 'vite build（corepack）に失敗しました'; exit 1 }
        }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $distIndex)) { Write-Error 'ビルド後に web\dist\index.html が見つかりません'; exit 1 }
    Write-Host 'Web クライアントのビルド完了'
}

# ---- 完了案内 ----
try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        ForEach-Object { $_.IPAddress })
} catch {
    $ips = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '127.*' -and $_.IPAddressToString -notlike '169.254.*' } |
        ForEach-Object { $_.IPAddressToString })
}
$port = 8443
$cfgPath = Join-Path $root 'config.json'
if (Test-Path $cfgPath) {
    try { $port = (Get-Content $cfgPath -Raw | ConvertFrom-Json).port } catch { }
}
Write-Host ''
Write-Host '=== セットアップ完了 ==='
Write-Host '起動:  powershell -File scripts\start-server.ps1'
Write-Host 'Quest 3（同一 Wi-Fi）のブラウザで:  https://<PCのIP>:<ポート>/'
if ($ips.Count -gt 0) {
    Write-Host "  例: https://$($ips[0]):$port/"
}
Write-Host '証明書の警告が出たら「詳細情報」→「続行」で開けます（README §3 参照）'
