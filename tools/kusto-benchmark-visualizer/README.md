# Kusto benchmark visualizer

Minimal Vite/React client for schemaVersion `1` Kusto-direct ExIQ ingestion benchmark artifacts.

## Run locally

```cmd
cd tools\kusto-benchmark-visualizer
npm install
npm run dev
```

The app accepts one or more JSON artifacts or a benchmark run folder through the picker or drag/drop area. Use **Live Stream** in the header to poll a benchmark run folder while it is being refreshed.

## Build

```cmd
cd tools\kusto-benchmark-visualizer
npm run build
```

The static output is written to `dist\`.

## Test

```cmd
cd tools\kusto-benchmark-visualizer
npm run test
npm run typecheck:test
```

## Artifact contract

The client expects the shared `schemaVersion: 1` shape with `run`, `iterations`, `memorySamples`, and `summary`. Each loaded run is isolated in-browser; no data leaves the page.
