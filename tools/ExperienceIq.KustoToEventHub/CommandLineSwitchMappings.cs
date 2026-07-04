namespace ExperienceIq.KustoToEventHub;

internal static class CommandLineSwitchMappings
{
    public static IDictionary<string, string> All { get; } = new Dictionary<string, string>
    {
        ["-i"] = "InputFile",
        ["--input-file"] = "InputFile",
        ["-u"] = "Cosmos:ObjectIds:0",
        ["--uid"] = "Cosmos:ObjectIds:0",
        ["-s"] = "Kusto:SessionId",
        ["--sessionid"] = "Kusto:SessionId",
    };

    public static bool HasExplicitUserId(string[] args)
        => HasSwitch(args, "-u", "--uid") || HasConfigurationKey(args, "Cosmos:ObjectIds");

    private static bool HasSwitch(string[] args, params string[] switches)
        => args.Any(arg => switches.Contains(arg, StringComparer.OrdinalIgnoreCase));

    private static bool HasConfigurationKey(string[] args, string key)
        => args.Any(arg =>
            arg.StartsWith(key, StringComparison.OrdinalIgnoreCase)
            && (arg.Length == key.Length || arg[key.Length] is ':' or '='));
}
