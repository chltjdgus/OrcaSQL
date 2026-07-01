<#
.SYNOPSIS
  StoreBroker를 이용해 Microsoft Partner Center에 MSIX를 제출합니다.

.PARAMETER TenantId
  Azure AD 테넌트 ID

.PARAMETER ClientId
  Azure AD 앱 등록 클라이언트 ID

.PARAMETER ClientSecret
  Azure AD 클라이언트 시크릿

.PARAMETER AppId
  Microsoft Store 앱 ID (Partner Center > 앱 개요에서 확인)

.PARAMETER MsixPath
  업로드할 .msix 파일 경로

.EXAMPLE
  pwsh -File submit.ps1 -TenantId "..." -ClientId "..." -ClientSecret "..." -AppId "..." -MsixPath "dist\OrcaSQL.msix"
#>
param(
    [Parameter(Mandatory)][string]$TenantId,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$ClientSecret,
    [Parameter(Mandatory)][string]$AppId,
    [Parameter(Mandatory)][string]$MsixPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── StoreBroker 설치 확인 ────────────────────────────────────────────────────
Write-Host "==> StoreBroker 설치 확인..."
if (-not (Get-Module -ListAvailable -Name StoreBroker)) {
    Write-Host "StoreBroker 모듈 설치 중..."
    Install-Module -Name StoreBroker -Force -AllowClobber -Scope CurrentUser
}
Import-Module StoreBroker

# ── Azure AD 인증 ─────────────────────────────────────────────────────────────
Write-Host "==> Partner Center 인증..."
$SecureSecret = ConvertTo-SecureString $ClientSecret -AsPlainText -Force
$Credential   = New-Object System.Management.Automation.PSCredential($ClientId, $SecureSecret)

Set-StoreBrokerAuthentication `
    -TenantId    $TenantId `
    -Credential  $Credential

# ── MSIX 경로 확인 ───────────────────────────────────────────────────────────
if (-not (Test-Path $MsixPath)) {
    Write-Error "MSIX 파일을 찾을 수 없습니다: $MsixPath"
}
$MsixPath = Resolve-Path $MsixPath

# ── 신규 제출 생성 ────────────────────────────────────────────────────────────
Write-Host "==> Partner Center 제출 생성 (AppId: $AppId)..."
$Submission = New-ApplicationSubmission -AppId $AppId -Force

# ── 패키지 업데이트 ───────────────────────────────────────────────────────────
Write-Host "==> 패키지 업로드..."
$Submission.applicationPackages = @(
    @{
        fileName             = [System.IO.Path]::GetFileName($MsixPath)
        fileStatus           = "PendingUpload"
        minimumDirectXVersion = "None"
        minimumSystemRam     = "None"
    }
)

$SubmissionId = $Submission.id
Set-ApplicationSubmission -AppId $AppId -UpdatedSubmission $Submission

Upload-SubmissionPackage `
    -PackagePath   $MsixPath `
    -UploadUrl     $Submission.fileUploadUrl

# ── 제출 완료 ────────────────────────────────────────────────────────────────
Write-Host "==> 제출 완료 요청..."
Complete-ApplicationSubmission -AppId $AppId -SubmissionId $SubmissionId

Write-Host "==> Partner Center 제출 완료. 심사 상태는 Partner Center 대시보드에서 확인하세요."
Write-Host "    https://partner.microsoft.com/dashboard/products/$AppId/submissions/$SubmissionId"
