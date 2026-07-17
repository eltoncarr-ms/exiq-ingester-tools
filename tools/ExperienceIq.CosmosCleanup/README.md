# ExperienceIQ Cosmos Cleanup

This tool removes all documents from the configured Cosmos DB containers by
starting a server-side deletion for each logical partition.

> [!WARNING]
> This operation is destructive. Confirm the account, database, containers, and
> partition-key paths before running it.

## Prerequisites

- .NET SDK 8.0 or later
- Azure CLI
- Access to the Cosmos DB account through `az login` or Visual Studio
- Cosmos DB data-plane permissions to query and delete container items
- The `DeleteAllItemsByPartitionKey` account capability

## Enable partition-key deletion

The capability is enabled at the Cosmos DB account level and is currently in
public preview. Set the resource group and account name:

```powershell
$resourceGroup = "<resource-group>"
$accountName = "exiqsqldb"
```

Read the account's existing capabilities and append
`DeleteAllItemsByPartitionKey`:

```powershell
$current = @(
    az cosmosdb show `
        --resource-group $resourceGroup `
        --name $accountName `
        --query "capabilities[].name" `
        --output tsv
)

$capabilities = @($current + "DeleteAllItemsByPartitionKey") |
    Sort-Object -Unique

az cosmosdb update `
    --resource-group $resourceGroup `
    --name $accountName `
    --capabilities $capabilities
```

The update must include every capability that should remain enabled because
`--capabilities` replaces the account's complete capability list.

Confirm the capability is enabled:

```powershell
az cosmosdb show `
    --resource-group $resourceGroup `
    --name $accountName `
    --query "capabilities[].name" `
    --output table
```

Enabling the capability requires account write permissions, such as the
**Cosmos DB Account Contributor** role. If the account rejects the update,
contact Azure Support to request enablement.

For service details and preview limitations, see
[Delete items by partition key value](https://learn.microsoft.com/azure/cosmos-db/how-to-delete-by-partition-key).

## Configure

Defaults in `appsettings.json` target:

- Account: `exiqsqldb`
- Database: `exiq`
- Containers: `interactions-v1` and `snapshots-v1`
- Hierarchical partition key: `/tenantId`, `/userId`
- Delete concurrency: `4`
- Active-delete-limit retries: `120` attempts, 5 seconds apart

Override these values with an untracked `appsettings.local.json`, environment
variables, or command-line configuration.

## Run

Sign in and start the cleanup from the repository root:

```powershell
az login
dotnet run --project tools\ExperienceIq.CosmosCleanup
```

The tool validates server-side partition deletion with the first logical
partition, starts the remaining purges concurrently, and verifies that each
container is empty. If Cosmos reaches its active partition-delete limit, the
tool waits and retries those partitions instead of failing the run.
