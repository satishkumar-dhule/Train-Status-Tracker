import {
  formatDuration as formatDurationFromTrainsData,
  formatShortDate as formatShortDateFromTrainsData,
} from "@workspace/trains-data";

export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUptime(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0)
    return "--";
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${Math.floor(totalSeconds % 60)}s`;
}

export function formatStatusCode(status: number | null): string {
  return status === null ? "ERR" : String(status);
}

export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}

export function formatDuration(totalMinutes: number | null): string {
  return totalMinutes === null
    ? "--"
    : formatDurationFromTrainsData(totalMinutes);
}

export function formatShortDate(isoDate: string): string {
  return formatShortDateFromTrainsData(isoDate);
}

export function formatStationName(code: string): string {
  return code.toUpperCase();
}

export function formatDelayPhrase(delayMinutes: number | null): string {
  if (delayMinutes === null || delayMinutes === 0) return "On time";
  if (delayMinutes > 0) return `${delayMinutes} min late`;
  return `${Math.abs(delayMinutes)} min early`;
}

export function formatDistance(km: number | null): string {
  if (km === null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km)} km`;
}
