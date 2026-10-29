# リリース zip 生成スクリプト（開発者向け）
# git 追跡ファイル＋ビルド済み web\dist をスリム zip にまとめる。
# 除外: 内部開発ドキュメント（PLAN/PROJECT_STATE/ARCHITECTURE/DECISIONS/TODO）、
#       および gitignore 済み的一切（Photos/ data/ certs/ .venv/ tools/node/ node_modules/ .pnpm-store/ PortableGit/ .tmp/）。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\make-release.ps1 [-Version v0.9.0]
# 前提: web\dist\index.html が存在すること（無ければ scripts\build-web.ps1 を先に実行）
param([string]$Version = 'v0.9.0')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$git = Join-Path $root 'PortableGit\bin\git.exe'
if (-not (Test-Path $git)) { $git = 'git' }  # PATH に git があればそれで代用

$distIndex = Join-Path $root 'web\dist\index.html'
if (-not (Test-Path $distIndex)) {
    Write-Error 'web\dist\index.html がありません。先に scripts\build-web.ps1 を実行してください。'
    exit 1
}

$stage = Join-Path $root ".tmp\release\pkg-$Version"
$outDir = Join-Path $root 'release'
$zipPath = Join-Path $outDir "fsvg-$Version.zip"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
New-Item -ItemType Directory -Force $outDir | Out-Null
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# git 追跡ファイル一覧（NUL 区切り。日本語ファイル名も安全に扱う）
$fileList = & $git -c core.quotepath=off ls-files
if ($LASTEXITCODE -ne 0) { Write-Error 'git ls-files に失敗しました'; exit 1 }

# 内部開発ドキュメントはエンドユーザー向け zip から除外（GitHub リポジトリには残る）
$excludeDocs = @('PLAN.md', 'PROJECT_STATE.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'TODO.md')

$copied = 0
foreach ($f in $fileList) {
    if ($excludeDocs -contains $f) { continue }
    $src = Join-Path $root $f
    if (-not (Test-Path $src)) { continue }  # 消された追跡ファイル（未コミット削除）はスキップ
    $dst = Join-Path $stage $f
    New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
    Copy-Item $src $dst
    $copied++
}

# ビルド済み Web クライアント（gitignore 済みだが zip には必須）
Copy-Item (Join-Path $root 'web\dist') (Join-Path $stage 'web\dist') -Recurse
$distCount = (Get-ChildItem (Join-Path $stage 'web\dist') -Recurse -File).Count

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ''
Write-Host "リリース zip 生成: $zipPath（$sizeMB MB・ソース $copied ファイル＋dist $distCount ファイル）"
Write-Host 'GitHub Release にはこの zip を添付してください。'
