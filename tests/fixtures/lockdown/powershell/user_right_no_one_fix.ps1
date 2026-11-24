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
    $desiredByRight = [ordered]@{}
    $desiredByRight['SeTrustedCredManAccessPrivilege'] = @()
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
