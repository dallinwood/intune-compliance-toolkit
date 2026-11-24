$ErrorActionPreference = 'Stop'
trap { Write-Output $_.Exception.Message; exit 1 }

function ConvertTo-AccountSid {
    param([string]$Account)
    if ($Account -match '^\*?(S-1-[0-9-]+)$') { return $Matches[1] }
    return ([System.Security.Principal.NTAccount]$Account).Translate([System.Security.Principal.SecurityIdentifier]).Value
}

$mismatchCount = 0
$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
try {
    New-Item -ItemType Directory -Path $workDirectory | Out-Null
    $exportPath = Join-Path $workDirectory 'export.inf'
    secedit /export /cfg $exportPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'secedit /export failed' }
    $holdersByRight = @{}
    foreach ($line in Get-Content -LiteralPath $exportPath) {
        if ($line -match '^(Se\w+)\s*=\s*(.*)$') {
            $holdersByRight[$Matches[1]] = @($Matches[2].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { ConvertTo-AccountSid $_ })
        }
    }
    $holders = @()
    if ($holdersByRight.ContainsKey('SeInteractiveLogonRight')) { $holders = $holdersByRight['SeInteractiveLogonRight'] }
    $expected = @('Administrators' | ForEach-Object { ConvertTo-AccountSid $_ })
    if ((($expected | Sort-Object -Unique) -join ',') -ne (($holders | Sort-Object -Unique) -join ',')) {
        Write-Output 'Mismatch: SeInteractiveLogonRight'
        $mismatchCount++
    }
}
finally {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
if ($mismatchCount -gt 0) { exit 1 }
exit 0
