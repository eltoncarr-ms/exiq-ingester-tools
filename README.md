# exiq-ingester-tools

Tools-only repository for ExperienceIQ data ingester operational utilities.

## Contents

- `tools/ExperienceIq.EventHubPeek`
- `tools/ExperienceIq.CosmosCleanup`
- `tools/ExperienceIq.KustoToEventHub`
- `tools/ExperienceIq.PartitionBatchRunner`
- `build-tools.cmd` (publishes all tools into one flat output folder)
- `merge-appsettings.ps1` (deterministically deep-merges tool `appsettings.json` files)

## Prerequisites

- .NET SDK 8.0+
- PowerShell 5.1+ (or PowerShell 7+)

## Build and publish all tools

From the repository root:

```cmd
build-tools.cmd
```

Optional configuration:

```cmd
build-tools.cmd Debug
```

Output is written to:

- `binaries/`

The script publishes every `*.csproj` under `tools/` to `binaries/` and then runs `merge-appsettings.ps1` to generate a single merged `binaries/appsettings.json`.

## Clear cursor-poller Cosmos data

The cleanup defaults target `exiqsqldb/exiq`, containers `interactions-v1` and
`snapshots-v1`. Run:

```powershell
dotnet run --project tools\ExperienceIq.CosmosCleanup
```

Override defaults with an untracked `appsettings.local.json`, environment
variables, or command-line configuration.
