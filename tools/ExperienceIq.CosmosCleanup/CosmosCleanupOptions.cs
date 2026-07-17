namespace ExperienceIq.CosmosCleanup;

internal sealed class CosmosCleanupOptions
{
    public const string SectionName = "CosmosCleanup";

    public string AccountEndpoint { get; init; } = "";

    public string DatabaseName { get; init; } = "";

    public List<ContainerCleanupOptions> Containers { get; init; } = [];

    public int PartitionDeleteConcurrency { get; init; } = 4;

    public int PartitionDeleteRetryAttempts { get; init; } = 120;

    public int PartitionDeleteRetryDelaySeconds { get; init; } = 5;

    public int VerificationAttempts { get; init; } = 10;

    public int VerificationDelaySeconds { get; init; } = 2;

    public void Validate()
    {
        if (!Uri.TryCreate(AccountEndpoint, UriKind.Absolute, out _))
        {
            throw new InvalidOperationException(
                $"{SectionName}:AccountEndpoint must be an absolute URI.");
        }

        if (string.IsNullOrWhiteSpace(DatabaseName))
        {
            throw new InvalidOperationException($"{SectionName}:DatabaseName is required.");
        }

        if (Containers.Count == 0)
        {
            throw new InvalidOperationException(
                $"{SectionName}:Containers must contain at least one container.");
        }

        if (PartitionDeleteConcurrency <= 0 ||
            PartitionDeleteRetryAttempts <= 0 ||
            PartitionDeleteRetryDelaySeconds <= 0 ||
            VerificationAttempts <= 0 ||
            VerificationDelaySeconds <= 0)
        {
            throw new InvalidOperationException(
                "Cleanup concurrency, retry, and verification values must be greater than zero.");
        }

        foreach (var container in Containers)
        {
            container.Validate();
        }
    }
}

internal sealed class ContainerCleanupOptions
{
    public string Name { get; init; } = "";

    public List<string> PartitionKeyPaths { get; init; } = [];

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            throw new InvalidOperationException("Every cleanup container requires a name.");
        }

        if (PartitionKeyPaths.Count == 0)
        {
            throw new InvalidOperationException(
                $"Container '{Name}' requires at least one partition-key path.");
        }

        foreach (var path in PartitionKeyPaths)
        {
            _ = PartitionKeyPath.Normalize(path);
        }
    }
}

internal static class PartitionKeyPath
{
    public static string Normalize(string path)
    {
        var property = path.Trim().TrimStart('/');
        if (string.IsNullOrWhiteSpace(property) || property.Contains('/'))
        {
            throw new InvalidOperationException(
                $"Only top-level partition-key paths are supported; received '{path}'.");
        }

        return property;
    }
}
