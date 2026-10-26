<#
.COPYRIGHT
Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
See LICENSE in the project root for license information.
#>
# Split from UserApplicationHardeningRemoveFeatures (ASD Blueprint for Secure Cloud) by this project; otherwise unmodified.

## Removing Powershell v 2.0
try {
    Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root -ErrorAction Stop

} catch {
    exit $LASTEXITCODE

}
