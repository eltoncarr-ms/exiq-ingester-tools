using System.Text;

namespace ExperienceIq.KustoToEventHub;

/// <summary>
/// Minimal RFC 4180-style CSV reader used to replay a saved Kusto query result
/// (CSV export) into Event Hub instead of running the live query. Handles
/// quoted fields, embedded commas/newlines and "" escaped quotes. The first
/// record is treated as the header row and each subsequent record is projected
/// into a dictionary keyed by column name.
/// </summary>
internal static class CsvRowReader
{
    public static IEnumerable<Dictionary<string, object?>> ReadRows(string path)
    {
        using var reader = new StreamReader(path);

        var headers = ParseRecord(reader);
        if (headers is null)
            yield break;

        while (true)
        {
            var fields = ParseRecord(reader);
            if (fields is null)
                break;

            // Skip blank lines (a single empty field with no others).
            if (fields.Count == 1 && fields[0].Length == 0)
                continue;

            var row = new Dictionary<string, object?>(headers.Count);
            for (int i = 0; i < headers.Count; i++)
                row[headers[i]] = i < fields.Count ? fields[i] : null;

            yield return row;
        }
    }

    /// <summary>
    /// Reads a single CSV record, which may span multiple physical lines when a
    /// quoted field contains a newline. Returns null at end of file.
    /// </summary>
    private static List<string>? ParseRecord(TextReader reader)
    {
        if (reader.Peek() == -1)
            return null;

        var fields = new List<string>();
        var sb = new StringBuilder();
        bool inQuotes = false;
        int read;

        while ((read = reader.Read()) != -1)
        {
            var ch = (char)read;

            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (reader.Peek() == '"')
                    {
                        reader.Read();
                        sb.Append('"');
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    sb.Append(ch);
                }
            }
            else
            {
                if (ch == '"')
                {
                    inQuotes = true;
                }
                else if (ch == ',')
                {
                    fields.Add(sb.ToString());
                    sb.Clear();
                }
                else if (ch == '\r')
                {
                    // Ignore; the line terminator is handled on '\n'.
                }
                else if (ch == '\n')
                {
                    break;
                }
                else
                {
                    sb.Append(ch);
                }
            }
        }

        fields.Add(sb.ToString());
        return fields;
    }
}
