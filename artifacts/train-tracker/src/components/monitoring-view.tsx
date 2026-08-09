import type { MonitoringResult } from "../hooks/use-api-monitoring";

export function MonitoringView({ result }: { result: MonitoringResult }) {
  return <div>{result.isPolling ? "Polling" : "Idle"}</div>;
}
