<#
.SYNOPSIS
  Deep-merges every tool's appsettings.json into a single converged operational
  file for the flat "binaries" output folder.

.DESCRIPTION
  The build publishes all tools into one flat folder, so each tool's
  appsettings.json would otherwise overwrite the others (last-publish-wins,
  which is non-deterministic). This script instead produces a deterministic
  superset by deep-merging the per-tool source appsettings.json files.

  Precedence is "first-wins" over an alphabetically-ordered file list: when the
  same scalar key exists in more than one file, the first file's value is kept.
  Missing keys/sections are added from later files, and nested objects are merged
  recursively. This yields a union that contains every tool's configuration
  (EventHubPeek's checkpoint + Peek settings, KustoToEventHub's real Kusto/Cosmos
  values, PartitionBatchRunner's PartitionBatch section, etc.).

.PARAMETER ToolsDir
  Directory containing the tool projects (each with an appsettings.json).

.PARAMETER OutputFile
  Path of the converged appsettings.json to write.
#>
param(
    [Parameter(Mandatory = $true)][string]$ToolsDir,
    [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = 'Stop'

function Merge-JsonObject {
    param($Base, $Overlay)
    # First-wins: keep $Base values; add what's missing from $Overlay; recurse into objects.
    foreach ($prop in $Overlay.PSObject.Properties) {
        $name = $prop.Name
        $overlayVal = $prop.Value
        $baseProp = $Base.PSObject.Properties[$name]

        if ($null -eq $baseProp) {
            $Base | Add-Member -NotePropertyName $name -NotePropertyValue $overlayVal -Force
        }
        elseif (($baseProp.Value -is [psobject]) -and ($baseProp.Value -isnot [System.Array]) -and
                ($overlayVal -is [psobject]) -and ($overlayVal -isnot [System.Array])) {
            Merge-JsonObject -Base $baseProp.Value -Overlay $overlayVal
        }
        # else: scalar/array conflict -> keep $Base value (first-wins).
    }
}

$files = Get-ChildItem -Path $ToolsDir -Recurse -Filter appsettings.json |
    Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
    Sort-Object FullName

if (-not $files) {
    Write-Error "No appsettings.json files found under '$ToolsDir'."
    exit 1
}

$merged = $null
foreach ($file in $files) {
    $json = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    if ($null -eq $merged) {
        $merged = $json
    }
    else {
        Merge-JsonObject -Base $merged -Overlay $json
    }
}

$jsonOut = $merged | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($OutputFile, $jsonOut, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Converged appsettings.json written to: $OutputFile"
Write-Host "  Merged $($files.Count) source file(s):"
foreach ($file in $files) { Write-Host "    - $($file.FullName)" }
