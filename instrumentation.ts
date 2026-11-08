import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

/**
 * This provider is deliberately private to the PostHog log lines introduced
 * here. Existing application console logging is not exported.
 */
export const posthogLogProvider =
  posthogToken && posthogHost
    ? new LoggerProvider({
        resource: resourceFromAttributes({ "service.name": "sheltuh-app" }),
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: new URL("/i/v1/logs", posthogHost).toString(),
              headers: {
                Authorization: `Bearer ${posthogToken}`,
                "Content-Type": "application/json",
              },
            }),
          }),
        ],
      })
    : undefined;

const posthogLogger = posthogLogProvider?.getLogger("sheltuh.posthog");

type LogAttributes = Record<string, boolean | number | string>;

export function emitPostHogLog(body: string, severityNumber: SeverityNumber, attributes: LogAttributes): void {
  posthogLogger?.emit({ body, severityNumber, attributes });
}

/** Flushes only the dedicated PostHog log provider after a Route Handler responds. */
export function flushPostHogLogs(): Promise<void> {
  return posthogLogProvider ? posthogLogProvider.forceFlush().catch(() => {}) : Promise.resolve();
}

export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!posthogLogProvider && process.env.NODE_ENV !== "production") {
    const missing = posthogToken ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
    console.warn(
      `${missing} variable required by PostHog is missing or un-configured, this causes events to be silently missed. ` +
        `This error stops appearing once ${missing} is configured`,
    );
  }
}
