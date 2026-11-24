$ErrorActionPreference = 'Stop'
trap { Write-Output $_.Exception.Message; exit 1 }

$mismatchCount = 0
$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
try {
    New-Item -ItemType Directory -Path $workDirectory | Out-Null
    $exportPath = Join-Path $workDirectory 'export.inf'
    secedit /export /cfg $exportPath /areas SECURITYPOLICY | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'secedit /export failed' }
    $exported = @{}
    $section = ''
    foreach ($line in Get-Content -LiteralPath $exportPath) {
        if ($line -match '^\[(.+)\]\s*$') { $section = $Matches[1] }
        elseif ($line -match '^\s*([^=]+?)\s*=\s*(.*?)\s*$') { $exported[$section + '|' + $Matches[1]] = $Matches[2] }
    }
    $current = $exported['System Access|EnableGuestAccount']
    if ($current -ne [string]0) {
        Write-Output 'Mismatch: [System Access] EnableGuestAccount'
        $mismatchCount++
    }
}
finally {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
if ($mismatchCount -gt 0) { exit 1 }
exit 0
