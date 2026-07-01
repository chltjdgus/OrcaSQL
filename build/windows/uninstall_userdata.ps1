# OrcaSQL MSI deferred CustomAction.
# REMOVE_USERDATA=1 옵션으로 언인스톨 시 호출되어
# 사용자 데이터 디렉토리와 Windows Credential Manager 의 OrcaSQL 항목을 정리한다.
#
# impersonate=yes 컨텍스트에서 실행되므로 $env:USERPROFILE 은 실제 사용자 프로필을 가리킨다.
# Return="ignore" 로 등록되어 실패해도 언인스톨 자체를 막지 않는다.

$ErrorActionPreference = 'Continue'

function Write-Log {
  param([string]$msg)
  $logDir = Join-Path $env:LOCALAPPDATA 'OrcaSQL'
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
  $logFile = Join-Path $logDir 'uninstall_userdata.log'
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $logFile -Value "[$stamp] $msg" -ErrorAction SilentlyContinue
}

Write-Log 'uninstall_userdata.ps1 started'

# 1) ~/.orcasql 디렉토리 제거
$dataDir = Join-Path $env:USERPROFILE '.orcasql'
if (Test-Path $dataDir) {
  try {
    Remove-Item -Path $dataDir -Recurse -Force -ErrorAction Stop
    Write-Log "Removed directory: $dataDir"
  } catch {
    Write-Log "Failed to remove directory ${dataDir}: $($_.Exception.Message)"
  }
} else {
  Write-Log "Directory not found (skipped): $dataDir"
}

# 2) Windows Credential Manager 의 orcasql* 항목 정리
# go-keyring 의 wincred 백엔드가 'service:user' 형식으로 저장하므로
# 'orcasql', 'orcasql-ssh', 'orcasql-proxy' 시작하는 항목을 모두 삭제한다.
try {
  $cmdkeyOutput = & cmdkey /list 2>&1
  $targets = @()
  foreach ($line in $cmdkeyOutput) {
    if ($line -match 'Target:\s*(.*orcasql.*)$') {
      $targets += $Matches[1].Trim()
    }
  }

  foreach ($target in $targets) {
    try {
      & cmdkey /delete:$target 2>&1 | Out-Null
      Write-Log "Deleted credential: $target"
    } catch {
      Write-Log "Failed to delete credential ${target}: $($_.Exception.Message)"
    }
  }

  if ($targets.Count -eq 0) {
    Write-Log 'No orcasql credentials found in Credential Manager'
  }
} catch {
  Write-Log "Credential Manager enumeration failed: $($_.Exception.Message)"
}

Write-Log 'uninstall_userdata.ps1 finished'
exit 0
