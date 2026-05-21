<#
.SYNOPSIS
  OrcaSQL MSIX 패키지 빌드 스크립트

.DESCRIPTION
  AppxManifest.xml 템플릿에 버전·퍼블리셔 CN을 치환하고,
  MSIX 스테이징 디렉터리를 구성한 뒤 makeappx + signtool로 서명합니다.

.PARAMETER Version
  앱 버전 (예: 1.0.0)

.PARAMETER PublisherCN
  Authenticode 인증서의 Subject CN (예: CN=My Company, O=..., C=US)

.PARAMETER CertPfxB64
  PFX 파일을 Base64 인코딩한 문자열 (GitHub Secret에서 주입)

.PARAMETER CertPassword
  PFX 파일 암호

.EXAMPLE
  pwsh -File package.ps1 -Version 1.0.0 -PublisherCN "CN=OrcaSQL" -CertPfxB64 "..." -CertPassword "pass"
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$PublisherCN,
    [string]$CertPfxB64 = "",
    [string]$CertPassword = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot  = Resolve-Path (Join-Path $PSScriptRoot "../../..")
$BinDir    = Join-Path $RepoRoot "bin"
$StageDir  = Join-Path $BinDir "msix-stage"
$AssetsDir = Join-Path $StageDir "Assets"
$OutMsix   = Join-Path $BinDir "OrcaSQL.msix"
$ExePath   = Join-Path $BinDir "OrcaSQL.exe"

Write-Host "==> MSIX 스테이징 디렉터리 초기화..."
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Path $AssetsDir | Out-Null

# ── 실행 파일 복사 ──────────────────────────────────────────────────────────
if (-not (Test-Path $ExePath)) {
    Write-Error "OrcaSQL.exe가 $BinDir 에 없습니다. wails3 build를 먼저 실행하세요."
}
Copy-Item $ExePath (Join-Path $StageDir "OrcaSQL.exe")

# ── AppxManifest.xml 생성 (템플릿 치환) ─────────────────────────────────────
Write-Host "==> AppxManifest.xml 생성..."
$ManifestTemplate = Join-Path $PSScriptRoot "AppxManifest.xml"
$ManifestContent  = Get-Content $ManifestTemplate -Raw
$ManifestContent  = $ManifestContent -replace '__PUBLISHER_CN__', $PublisherCN
$ManifestContent  = $ManifestContent -replace '__VERSION__', $Version
Set-Content (Join-Path $StageDir "AppxManifest.xml") $ManifestContent -Encoding UTF8

# ── MSIX 로고 자산 생성 (ImageMagick 사용) ──────────────────────────────────
Write-Host "==> MSIX 로고 자산 생성..."
$IconSource = Join-Path $RepoRoot "build\windows\icon.ico"

# .ico 는 다중 프레임(16/32/48/64/128/256 px) 컨테이너 — magick 이 기본적으로 모든 프레임을
# 별도 PNG (`Square44x44Logo-0.png`, `-1.png`, ...) 로 분리 출력해서 정확히 `Square44x44Logo.png`
# 라는 파일이 생성되지 않는다 → makeappx 가 manifest 참조 파일 부재로 실패한다.
# 가장 큰 프레임 1개만 임시 PNG 로 추출해 모든 사이즈의 소스로 사용한다.
$IconFramesDir = Join-Path $env:TEMP "orcasql-icon-frames"
if (Test-Path $IconFramesDir) { Remove-Item $IconFramesDir -Recurse -Force }
New-Item -ItemType Directory -Path $IconFramesDir | Out-Null

& magick $IconSource (Join-Path $IconFramesDir "frame-%d.png")
if ($LASTEXITCODE -ne 0) { Write-Error ".ico → PNG 프레임 분리 실패" }

# ICO 컨테이너의 프레임 순서는 보장되지 않음 — 파일 크기로 가장 큰 프레임을 선택 (보통 256x256)
$LargestFrame = Get-ChildItem $IconFramesDir -Filter "*.png" |
    Sort-Object Length -Descending |
    Select-Object -First 1
if (-not $LargestFrame) { Write-Error ".ico 에서 PNG 프레임을 추출하지 못함" }
Write-Host "    largest frame: $($LargestFrame.Name) ($($LargestFrame.Length) bytes)"
$IconPngSource = $LargestFrame.FullName

$AssetSizes = @{
    "Square44x44Logo.png"    = "44x44"
    "Square150x150Logo.png"  = "150x150"
    "Wide310x150Logo.png"    = "310x150"
    "Square310x310Logo.png"  = "310x310"
    "StoreLogo.png"          = "50x50"
    "SplashScreen.png"       = "620x300"
}

foreach ($AssetName in $AssetSizes.Keys) {
    $Size = $AssetSizes[$AssetName]
    $OutPath = Join-Path $AssetsDir $AssetName
    & magick $IconPngSource -resize $Size -background transparent -gravity center -extent $Size $OutPath
    if ($LASTEXITCODE -ne 0) {
        # 빈 PNG fallback 은 makeappx 가 통과해도 Store 가 거부 → 하드 페일이 옳다.
        Write-Error "ImageMagick 변환 실패: $AssetName"
    }
}

Remove-Item $IconFramesDir -Recurse -Force -ErrorAction SilentlyContinue

# ── Windows SDK 도구 동적 탐색 ───────────────────────────────────────────────
# GitHub Actions windows-latest 러너의 SDK 버전은 시점마다 다르다 (10.0.22621 / 10.0.26100 / ...).
# 하드코딩 대신 설치된 가장 최신 버전을 골라 사용한다.
function Get-WindowsSdkTool {
    param([Parameter(Mandatory)][string]$ToolName)

    $SdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $SdkRoot) {
        $Latest = Get-ChildItem $SdkRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^10\.\d+\.\d+\.\d+$' } |
            Sort-Object { [version]$_.Name } -Descending |
            Select-Object -First 1
        if ($Latest) {
            $ToolPath = Join-Path $Latest.FullName "x64\$ToolName"
            if (Test-Path $ToolPath) { return $ToolPath }
        }
    }
    $Cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($Cmd) { return $Cmd.Source }
    return $null
}

# ── makeappx로 MSIX 패키징 ───────────────────────────────────────────────────
Write-Host "==> makeappx pack..."
$MakeAppx = Get-WindowsSdkTool 'makeappx.exe'
if (-not $MakeAppx) {
    Write-Error "makeappx.exe를 찾을 수 없습니다. Windows SDK (10.0.x) 를 설치하세요."
}
Write-Host "    using: $MakeAppx"
& $MakeAppx pack /d $StageDir /p $OutMsix /overwrite
if ($LASTEXITCODE -ne 0) { Write-Error "makeappx 실패" }

# ── signtool로 서명 (인증서가 제공된 경우만) ─────────────────────────────────
if ($CertPfxB64 -and $CertPassword) {
    Write-Host "==> 코드 서명..."
    $PfxPath = Join-Path $env:TEMP "websql-sign.pfx"
    try {
        [System.IO.File]::WriteAllBytes($PfxPath, [System.Convert]::FromBase64String($CertPfxB64))
        $SignTool = Get-WindowsSdkTool 'signtool.exe'
        if (-not $SignTool) { Write-Error "signtool.exe를 찾을 수 없습니다." }
        Write-Host "    using: $SignTool"
        & $SignTool sign /fd SHA256 /a /f $PfxPath /p $CertPassword $OutMsix
        if ($LASTEXITCODE -ne 0) { Write-Error "signtool 서명 실패" }
        Write-Host "서명 완료."
    } finally {
        if (Test-Path $PfxPath) { Remove-Item $PfxPath -Force }
    }
} else {
    Write-Host "CertPfxB64/CertPassword 미제공 — 서명 단계를 건너뜁니다."
}

Write-Host "==> MSIX 생성 완료: $OutMsix"
