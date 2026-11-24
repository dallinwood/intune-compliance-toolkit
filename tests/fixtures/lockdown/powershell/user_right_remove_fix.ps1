$ErrorActionPreference = 'Stop'
trap { Write-Output $_.Exception.Message; exit 1 }

function ConvertTo-AccountSid {
    param([string]$Account)
    if ($Account -match '^\*?(S-1-[0-9-]+)$') { return $Matches[1] }
    return ([System.Security.Principal.NTAccount]$Account).Translate([System.Security.Principal.SecurityIdentifier]).Value
}

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
    $desiredByRight = [ordered]@{}
    $holders = @()
    if ($holdersByRight.ContainsKey('SeDenyNetworkLogonRight')) { $holders = $holdersByRight['SeDenyNetworkLogonRight'] }
    $removed = @('Guests' | ForEach-Object { ConvertTo-AccountSid $_ })
    $desiredByRight['SeDenyNetworkLogonRight'] = @($holders | Where-Object { $removed -notcontains $_ })
    $infLines = @('[Unicode]', 'Unicode=yes', '[Privilege Rights]')
    foreach ($right in $desiredByRight.Keys) {
        $infLines += ($right + ' = ' + (@($desiredByRight[$right] | ForEach-Object { '*' + $_ }) -join ','))
    }
    $infLines += @('[Version]', 'signature="$CHICAGO$"', 'Revision=1')
    $infPath = Join-Path $workDirectory 'rights.inf'
    Set-Content -LiteralPath $infPath -Value $infLines -Encoding Unicode
    secedit /configure /db (Join-Path $workDirectory 'rights.sdb') /cfg $infPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'secedit /configure failed' }
}
finally {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
