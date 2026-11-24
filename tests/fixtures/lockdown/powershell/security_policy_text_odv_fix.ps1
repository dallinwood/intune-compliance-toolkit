$ErrorActionPreference = 'Stop'
trap { Write-Output $_.Exception.Message; exit 1 }

$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
try {
    New-Item -ItemType Directory -Path $workDirectory | Out-Null
    $infLines = @(
        '[Unicode]',
        'Unicode=yes',
        '[System Access]',
        ('newadministratorname = "' + '$ODV_admin_username' + '"'),
        '[Version]',
        'signature="$CHICAGO$"',
        'Revision=1'
    )
    $infPath = Join-Path $workDirectory 'policy.inf'
    Set-Content -LiteralPath $infPath -Value $infLines -Encoding Unicode
    secedit /configure /db (Join-Path $workDirectory 'policy.sdb') /cfg $infPath /areas SECURITYPOLICY | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'secedit /configure failed' }
}
finally {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
