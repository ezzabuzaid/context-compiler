import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Shutdown } from '@zukhruf/shutdown';

import { EltInstrumentation } from '@workspace/elt-opentelemetry';

import pipeline from './pipeline.ts';

using shutdown = new Shutdown();
// The crawl's spans, metrics and log records, over OTLP to
// OTEL_EXPORTER_OTLP_ENDPOINT, or to http://localhost:4318 as elt's
// infra:up-otel serves it.
const sdk = new NodeSDK({
  serviceName: 'logful',
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 5000,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }),
  ],
  instrumentations: [new EltInstrumentation(globalThis)],
});
sdk.start();
// The SDK exports what it still holds once the pass ends, or stops.
await using telemetry = new AsyncDisposableStack();
telemetry.defer(() => sdk.shutdown());
// One pass: the crawl of the input to its end, or to the stop.
await pipeline.run({ signal: shutdown.signal });
