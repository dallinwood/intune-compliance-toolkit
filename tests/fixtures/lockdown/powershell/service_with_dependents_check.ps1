$mismatchCount = 0

$service = Get-Service -Name 'Spooler' -ErrorAction SilentlyContinue
if ($service) {
    if ($service.StartType -ne 'Disabled') {
        Write-Output ('Mismatch: service Spooler start type is ' + $service.StartType + ', expected Disabled')
        $mismatchCount++
    }
    if ($service.Status -ne 'Stopped') {
        Write-Output ('Mismatch: service Spooler is ' + $service.Status + ', expected Stopped')
        $mismatchCount++
    }
}

if ($mismatchCount -gt 0) { exit 1 }
exit 0
