using System.Reflection;
using System.Text.Json;
using ExperienceIq.DataIngester.Contracts;
using ExperienceIq.DataIngester.Cosmos;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace ExperienceIq.PartitionBatchRunner;

public sealed class DryRunEventSink(
    IConfigProvider configProvider,
    ILogger<DryRunEventSink>? logger = null) : IEventSink
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IConfigProvider _configProvider = configProvider
        ?? throw new ArgumentNullException(nameof(configProvider));
    private readonly ILogger<DryRunEventSink> _logger = logger ?? NullLogger<DryRunEventSink>.Instance;

    public Task<EventWriteResult> WriteAsync(
        AssemblyState assembly,
        FlushDecision decision,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var lifecycle = ResolveLifecycle(assembly);
        var output = lifecycle.Definition.Output;
        var representativeRecord = assembly.Parts.Values
            .OrderByDescending(item => item.ReceivedAtUtc)
            .Select(item => item.Record)
            .FirstOrDefault();

        var templateValues = BuildTemplateValues(assembly, representativeRecord, decision);
        var id = RenderTemplate(output.IdTemplate, templateValues);
        var partitionKey = RenderTemplate(output.PartitionKeyTemplate, templateValues);
        var preview = BuildPreview(assembly, decision, id, partitionKey);
        var json = JsonSerializer.Serialize(preview, JsonOptions);

        if (_logger.IsEnabled(LogLevel.Information))
        {
            _logger.LogInformation("DRY-RUN write {Id} {PartitionKey} {Payload}", id, partitionKey, json);
        }
        else
        {
            Console.WriteLine($"DRY-RUN write {id} {partitionKey} {json}");
        }

        return Task.FromResult(new EventWriteResult(id, partitionKey, Updated: assembly.HasPartialFlush));
    }

    private ResolvedLifecycleDefinition ResolveLifecycle(AssemblyState assembly)
    {
        var lifecycle = _configProvider.Current.Lifecycles.FirstOrDefault(item =>
            string.Equals(item.Definition.Name, assembly.LifecycleName, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(item.Definition.Version, assembly.LifecycleVersion, StringComparison.OrdinalIgnoreCase));

        return lifecycle ?? throw new InvalidOperationException(
            $"Lifecycle '{assembly.LifecycleName}:{assembly.LifecycleVersion}' is not active in current configuration.");
    }

    private static Dictionary<string, string?> BuildTemplateValues(
        AssemblyState assembly,
        EnvelopeRecord? representativeRecord,
        FlushDecision decision)
    {
        return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["sessionId"] = assembly.Key.SessionId,
            ["eventId"] = assembly.Key.EventId,
            ["eventType"] = representativeRecord?.EventType,
            ["partitionId"] = representativeRecord?.PartitionId,
            ["sequenceNumber"] = representativeRecord?.SequenceNumber.ToString(),
            ["offset"] = representativeRecord?.Offset,
            ["lifecycleName"] = assembly.LifecycleName,
            ["lifecycleVersion"] = assembly.LifecycleVersion,
            ["flushReason"] = decision.Reason.ToString()
        };
    }

    private static IReadOnlyDictionary<string, object?> BuildPreview(
        AssemblyState assembly,
        FlushDecision decision,
        string id,
        string partitionKey)
    {
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = id,
            ["partitionKey"] = partitionKey,
            ["sessionId"] = assembly.Key.SessionId,
            ["eventId"] = assembly.Key.EventId,
            ["lifecycleName"] = assembly.LifecycleName,
            ["lifecycleVersion"] = assembly.LifecycleVersion,
            ["flushReason"] = decision.Reason.ToString(),
            ["flushDetail"] = decision.Detail,
            ["isPartial"] = decision.IsPartial,
            ["hasPartialFlush"] = assembly.HasPartialFlush,
            ["parts"] = assembly.Parts.Values
                .OrderBy(item => item.Record.SequenceNumber)
                .Select(item => new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["partName"] = item.PartName,
                    ["eventType"] = item.Record.EventType,
                    ["timestampUtc"] = item.Record.TimestampUtc,
                    ["partitionId"] = item.Record.PartitionId,
                    ["sequenceNumber"] = item.Record.SequenceNumber,
                    ["offset"] = item.Record.Offset,
                    ["dedupeKey"] = item.Record.DedupeKey,
                    ["isDuplicate"] = item.IsDuplicate,
                    ["receivedAtUtc"] = item.ReceivedAtUtc
                })
                .ToArray()
        };
    }

    private static string RenderTemplate(string template, IReadOnlyDictionary<string, string?> values)
    {
        var rendererType = typeof(CosmosEventSink).Assembly.GetType("ExperienceIq.DataIngester.Cosmos.TemplateRenderer")
            ?? throw new InvalidOperationException("TemplateRenderer type could not be found.");
        var renderMethod = rendererType.GetMethod(
            "Render",
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static,
            binder: null,
            types: [typeof(string), typeof(IReadOnlyDictionary<string, string?>)],
            modifiers: null)
            ?? throw new InvalidOperationException("TemplateRenderer.Render method could not be found.");

        try
        {
            return renderMethod.Invoke(null, [template, values]) as string
                ?? throw new InvalidOperationException("TemplateRenderer.Render returned null.");
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw ex.InnerException;
        }
    }
}
