# GitHub 公開スクリプト（開発者向け・エンドユーザー zip には同梱しない）
# リポジトリ作成 → main push → README プレースホルダ差し替え → Release 作成＋zip 添付 を一括実行する。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1 -Owner <GitHubユーザー名> [-Version v0.9.0]
#   -Token を省略すると対話入力（非エコー）で受け取ります。
#   トークンは push 中のみ remote URL に使い、push 後クリーンな URL に戻します（保存しません）。
# 前提: release\fsvg-<Version>.zip が存在すること（scripts\make-release.ps1 を先に実行）。
# 注意: Owner はトークン所有者の個人アカウントであること（組織リポジトリの作成には未対応）。
param(
    [Parameter(Mandatory = $true)][string]$Owner,
    [string]$Token = '',
    [string]$Repo = 'fullscalevrphotogallery',
    [string]$Version = 'v0.9.0',
    [string]$ZipPath = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Token) {
    $sec = Read-Host 'GitHub Personal Access Token（repo スコープ）を入力してください' -AsSecureString
    $Token = [Net.NetworkCredential]::new('', $sec).Password
}
if (-not $ZipPath) { $ZipPath = Join-Path $root "release\fsvg-$Version.zip" }
if (-not (Test-Path $ZipPath)) {
    Write-Error "zip が見つかりません: $ZipPath（先に scripts\make-release.ps1 を実行してください）"
    exit 1
}

$git = Join-Path $root 'PortableGit\bin\git.exe'
if (-not (Test-Path $git)) { $git = 'git' }

# git のネイティブ stderr 出力が EAP=Stop で例外化されるため、git 呼び出しは EAP を緩めて実行する
function Invoke-Git {
    param([string[]]$GitArgs)
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { return & $git @GitArgs 2>&1 } finally { $ErrorActionPreference = $prevEAP }
}

$headers = @{
    Authorization      = "token $Token"
    Accept             = 'application/vnd.github+json'
    'User-Agent'       = 'fsvg-publish-github'
    'X-GitHub-Api-Version' = '2022-11-28'
}
$api = 'https://api.github.com'

# 1) リポジトリ作成（既存なら再利用）
try {
    Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo" -Headers $headers -Method Get | Out-Null
    Write-Host "リポジトリは既存です: $Owner/$Repo"
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
        $createBody = @{ name = $Repo; private = $false; has_wiki = $false; has_issues = $false } | ConvertTo-Json
        Invoke-RestMethod -Uri "$api/user/repos" -Headers $headers -Method Post -Body $createBody -ContentType 'application/json' | Out-Null
        Write-Host "リポジトリを作成しました（公開）: $Owner/$Repo"
    } else { throw }
}

# 2) README プレースホルダ差し替え（変更があればコミット）
$readme = Join-Path $root 'README.md'
$rc = Get-Content $readme -Raw -Encoding UTF8
if ($rc -match '<あなたのGitHubユーザー名>') {
    $rc2 = $rc.Replace('<あなたのGitHubユーザー名>', $Owner)
    [System.IO.File]::WriteAllText($readme, $rc2, (New-Object System.Text.UTF8Encoding($false)))
    Invoke-Git @('add', 'README.md') | Out-Null
    Invoke-Git @('commit', '-m', "docs: README の GitHub URL プレースホルダを $Owner に差し替え") | Out-Null
    Write-Host "README プレースホルダを $Owner に差し替えてコミットしました"
}

# 3) push（トークン入り URL で一時的に push し、直後にクリーン URL へ戻す）
$cleanUrl = "https://github.com/$Owner/$Repo.git"
$authUrl  = "https://x-access-token:$Token@github.com/$Owner/$Repo.git"
$hasRemote = $false
Invoke-Git @('remote', 'get-url', 'origin') | Out-Null
if ($LASTEXITCODE -eq 0) { $hasRemote = $true }
if ($hasRemote) { Invoke-Git @('remote', 'set-url', 'origin', $authUrl) | Out-Null }
else { Invoke-Git @('remote', 'add', 'origin', $authUrl) | Out-Null }

$pushOut = Invoke-Git @('push', '-u', 'origin', 'main')
if ($LASTEXITCODE -ne 0) {
    Invoke-Git @('remote', 'set-url', 'origin', $cleanUrl) | Out-Null
    Write-Error "push に失敗しました: $($pushOut -join ' / ')"
    exit 1
}
Invoke-Git @('remote', 'set-url', 'origin', $cleanUrl) | Out-Null
Write-Host "push 完了: $cleanUrl（remote URL からトークンは除去済み）"

# 4) Release 作成（既存なら取得）
try {
    $relBody = @{
        tag_name   = $Version
        name       = "FullScale VR Photo Gallery $Version"
        body       = "リリース zip（fsvg-$Version.zip）を添付しています。セットアップ手順は README.md §2 を参照してください。"
        draft      = $false
        prerelease = $false
    } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo/releases" -Headers $headers -Method Post -Body $relBody -ContentType 'application/json'
    Write-Host "Release を作成しました: $($release.html_url)"
} catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 422) {
        $release = Invoke-RestMethod -Uri "$api/repos/$Owner/$Repo/releases/tags/$Version" -Headers $headers -Method Get
        Write-Host "Release は既存です: $($release.html_url)"
    } else { throw }
}

# 5) zip 添付（同名アセットがあれば差し替え）
$zipName = Split-Path -Leaf $ZipPath
$old = $release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
if ($old) {
    Invoke-RestMethod -Uri $old.url -Headers $headers -Method Delete | Out-Null
    Write-Host "既存アセットを削除して差し替えます: $zipName"
}
$uploadUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$zipName"
Invoke-RestMethod -Uri $uploadUrl -Headers $headers -Method Post -InFile $ZipPath -ContentType 'application/zip' | Out-Null
Write-Host "アセット添付完了: $zipName"
Write-Host ''
Write-Host "公開完了: $cleanUrl"
Write-Host "Release: $($release.html_url)"
