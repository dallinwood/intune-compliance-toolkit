<#
.COPYRIGHT
Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
See LICENSE in the project root for license information.
#>
# Split from UserApplicationHardeningRemoveFeatures (ASD Blueprint for Secure Cloud) by this project; otherwise unmodified.

## Removing .NET 3.5 (and below)
try {
    Disable-WindowsOptionalFeature -Online -FeatureName NetFx3 -NoRestart

} catch {
    exit $LASTEXITCODE

}
