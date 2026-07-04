using System.Text;
using Azure.Core;
using Azure.Identity;
using Azure.Messaging.EventHubs.Consumer;
using ExperienceIq.DataIngester;
using ExperienceIq.DataIngester.Contracts;
using ExperienceIq.DataIngester.Hosting;
using ExperienceIq.DataIngester.PartitionBatch;
using ExperienceIq.PartitionBatchRunner;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

return await RunAsync(args);

static async Task<int> RunAsync(string[] args)
{
    Console.OutputEncoding = Encoding.UTF8;

    using var cancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) =>
    {
        eventArgs.Cancel = true;
        cancellation.Cancel();
    };

    ServiceProvider? serviceProvider = null;

    try
    {
        var normalizedArgs = NormalizeCommandLine(args);
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .AddEnvironmentVariables()
            .AddCommandLine(normalizedArgs)
            .Build();

        var partitionSection = configuration.GetSection("PartitionBatch");
        var partitionId = Required(partitionSection["PartitionId"], "PartitionBatch:PartitionId");
        var idleSeconds = partitionSection.GetValue("IdleSeconds", 5);
        if (idleSeconds <= 0)
        {
            throw new InvalidOperationException("PartitionBatch:IdleSeconds must be greater than zero.");
        }

        var maxMessages = partitionSection.GetValue<int?>("MaxMessages");
        if (maxMessages is <= 0)
        {
            throw new InvalidOperationException("PartitionBatch:MaxMessages must be greater than zero when set.");
        }

        var dryRun = partitionSection.GetValue("DryRun", true);
        var lifecycleConfigPath = ResolvePath(
            partitionSection["LifecycleConfigPath"],
            "lifecycle.poc-session.json");
        var lifecycleSchemaPath = ResolvePath(
            partitionSection["LifecycleSchemaPath"],
            "lifecycle-config.schema.json");

        var eventHubSection = configuration.GetSection("EventHub");
        var fullyQualifiedNamespace = Required(
            eventHubSection["FullyQualifiedNamespace"],
            "EventHub:FullyQualifiedNamespace");
        var eventHubName = Required(eventHubSection["EventHubName"], "EventHub:EventHubName");
        var consumerGroup = string.IsNullOrWhiteSpace(eventHubSection["ConsumerGroup"])
            ? EventHubConsumerClient.DefaultConsumerGroupName
            : eventHubSection["ConsumerGroup"]!;

        Console.WriteLine("================ Partition Batch Runner ================");
        Console.WriteLine($"Namespace        : {fullyQualifiedNamespace}");
        Console.WriteLine($"Event Hub        : {eventHubName}");
        Console.WriteLine($"Consumer group   : {consumerGroup}");
        Console.WriteLine($"Partition        : {partitionId}");
        Console.WriteLine($"Mode             : {(dryRun ? "DryRun" : "Cosmos")}");
        Console.WriteLine($"Timestamp (UTC)  : {DateTimeOffset.UtcNow:O}");
        Console.WriteLine("========================================================");

        using var loggerFactory = LoggerFactory.Create(builder =>
        {
            builder
                .AddSimpleConsole(options =>
                {
                    options.SingleLine = true;
                    options.TimestampFormat = "HH:mm:ss ";
                })
                .SetMinimumLevel(LogLevel.Information);
        });

        var configProvider = new ValidatingConfigProvider(
            loggerFactory.CreateLogger<ValidatingConfigProvider>());
        await configProvider.LoadAsync(lifecycleConfigPath, lifecycleSchemaPath, cancellation.Token);

        IRecordReader recordReader = new ConfiguredRecordReader(
            configProvider,
            loggerFactory.CreateLogger<ConfiguredRecordReader>());
        ILifecycleResolver resolver = new LifecycleSelectorResolver(configProvider);

        TokenCredential credential = new ChainedTokenCredential(
            new AzureCliCredential(),
            new DefaultAzureCredential(new DefaultAzureCredentialOptions
            {
                ExcludeInteractiveBrowserCredential = true
            }));

        IEventSink sink;
        if (dryRun)
        {
            sink = new DryRunEventSink(
                configProvider,
                loggerFactory.CreateLogger<DryRunEventSink>());
        }
        else
        {
            Required(configuration["Cosmos:AccountEndpoint"], "Cosmos:AccountEndpoint");
            Required(configuration["Cosmos:DatabaseName"], "Cosmos:DatabaseName");

            var services = new ServiceCollection();
            services.AddLogging(builder =>
            {
                builder
                    .AddSimpleConsole(options =>
                    {
                        options.SingleLine = true;
                        options.TimestampFormat = "HH:mm:ss ";
                    })
                    .SetMinimumLevel(LogLevel.Information);
            });
            services.AddSingleton(credential);
            services.AddSingleton<IConfigProvider>(configProvider);
            services.AddIngesterCosmos(configuration);
            serviceProvider = services.BuildServiceProvider();
            sink = serviceProvider.GetRequiredService<IEventSink>();
        }

        await using var consumer = new EventHubConsumerClient(
            consumerGroup,
            fullyQualifiedNamespace,
            eventHubName,
            credential);

        try
        {
            await consumer.GetPartitionPropertiesAsync(partitionId, cancellation.Token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"\nFAILED to connect / authorize against the Event Hub:\n{ex.GetType().Name}: {ex.Message}");
            Console.Error.WriteLine("\nEnsure the signed-in identity has the 'Azure Event Hubs Data Receiver' role on the namespace or hub.");
            return 2;
        }

        var source = new EventHubPartitionMessageSource(
            consumer,
            recordReader,
            loggerFactory.CreateLogger<EventHubPartitionMessageSource>());
        var processor = new BatchEventProcessor(
            resolver,
            sink,
            loggerFactory.CreateLogger<BatchEventProcessor>());
        var worker = new SinglePartitionWorker(source, processor);

        BatchResult result;
        try
        {
            result = await worker.RunAsync(
                new PartitionReadRequest(
                    partitionId,
                    FromEarliest: true,
                    IdleTimeout: TimeSpan.FromSeconds(idleSeconds),
                    MaxMessages: maxMessages),
                cancellation.Token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"\nFAILED during Event Hub partition read / batch processing:\n{ex.GetType().Name}: {ex.Message}");
            Console.Error.WriteLine("\nEnsure the signed-in identity has the 'Azure Event Hubs Data Receiver' role on the namespace or hub.");
            return 2;
        }

        Console.WriteLine("\n================ SUMMARY ================");
        Console.WriteLine($"MessagesRead        : {result.MessagesRead}");
        Console.WriteLine($"Duplicates          : {result.Duplicates}");
        Console.WriteLine($"Skipped             : {result.Skipped}");
        Console.WriteLine($"AssembliesProcessed : {result.AssembliesProcessed}");
        Console.WriteLine($"Flushed             : {result.Flushed}");
        Console.WriteLine($"Incomplete          : {result.Incomplete}");

        if (dryRun && result.Writes.Count > 0)
        {
            Console.WriteLine("\nDry-run writes:");
            foreach (var write in result.Writes)
            {
                Console.WriteLine($"  id={write.Id} partitionKey={write.PartitionKey} updated={write.Updated}");
            }
        }

        Console.WriteLine("=========================================");
        return 0;
    }
    catch (ConfigValidationException ex)
    {
        Console.Error.WriteLine($"Lifecycle configuration failed validation: {ex.Message}");
        return 2;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("Partition batch run cancelled.");
        return 2;
    }
    catch (OptionsValidationException ex)
    {
        Console.Error.WriteLine($"Configuration failure: {string.Join("; ", ex.Failures)}");
        return 2;
    }
    catch (Exception ex) when (ex is InvalidOperationException or FormatException or System.IO.IOException)
    {
        Console.Error.WriteLine($"Configuration failure: {ex.Message}");
        return 2;
    }
    finally
    {
        if (serviceProvider is not null)
        {
            await serviceProvider.DisposeAsync();
        }
    }
}

static string[] NormalizeCommandLine(string[] args)
{
    var normalized = new List<string>(args.Length);
    foreach (var arg in args)
    {
        if (string.Equals(arg, "--dry-run", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("PartitionBatch:DryRun=true");
        }
        else if (string.Equals(arg, "--no-dry-run", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("PartitionBatch:DryRun=false");
        }
        else
        {
            normalized.Add(arg);
        }
    }

    return normalized.ToArray();
}

static string Required(string? value, string key)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        throw new InvalidOperationException($"{key} is required.");
    }

    return value;
}

static string ResolvePath(string? configuredPath, string defaultFileName)
{
    var path = string.IsNullOrWhiteSpace(configuredPath) ? defaultFileName : configuredPath;
    return Path.GetFullPath(
        Path.IsPathRooted(path)
            ? path
            : Path.Combine(AppContext.BaseDirectory, path));
}
