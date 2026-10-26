<#
.COPYRIGHT
Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
See LICENSE in the project root for license information.
#>
# Split from UserApplicationHardeningRemoveFeatures (ASD Blueprint for Secure Cloud) by this project; otherwise unmodified.

## Removing Internet Explorer (for Windows 10)
if ((Get-WmiObject -class Win32_OperatingSystem).version -gt [version]'10.0.0') {
    try {
        Disable-WindowsOptionalFeature -Online -FeatureName Internet-Explorer-Optional-amd64 -NoRestart
    
    } catch {
    
        exit $LASTEXITCODE
    
    }
}
