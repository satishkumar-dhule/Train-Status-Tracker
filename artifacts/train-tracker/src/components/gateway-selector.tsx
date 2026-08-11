import { formatProviderName } from "../lib/providers";

/** The synthetic gateway option meaning "try providers in failover order". */
export const GATEWAY_AUTO = "auto";

/**
 * Lets the user pin the status lookup to a single data source ("gateway") or
 * fall back to the default auto-failover chain. The list of gateways comes
 * from the API's enabled providers; only "Auto" is offered when none loaded.
 */
export function GatewaySelector({
  gateways,
  value,
  onChange,
}: {
  gateways: readonly string[];
  value: string;
  onChange: (gateway: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-2.5"
      data-testid="gateway-selector"
    >
      <label
        htmlFor="select-gateway"
        className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
      >
        Data source
      </label>
      <select
        id="select-gateway"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid="select-gateway"
        className="h-9 min-w-0 rounded-lg border border-card-border bg-background px-2.5 font-mono text-sm font-medium text-foreground"
      >
        <option value={GATEWAY_AUTO}>Auto (failover)</option>
        {gateways.map((gateway) => (
          <option key={gateway} value={gateway}>
            {formatProviderName(gateway)}
          </option>
        ))}
      </select>
    </div>
  );
}
