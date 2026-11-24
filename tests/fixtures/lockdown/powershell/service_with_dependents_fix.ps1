$ErrorActionPreference = 'Stop'
trap { Write-Output $_.Exception.Message; exit 1 }

$service = Get-Service -Name 'Spooler' -ErrorAction SilentlyContinue
if ($service) {
    Set-Service -Name 'Spooler' -StartupType Disabled
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name 'Spooler' -Force
    }
}

exit 0
