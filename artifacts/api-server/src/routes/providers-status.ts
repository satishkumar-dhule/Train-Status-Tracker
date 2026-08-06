import { Router, type IRouter } from "express";
import { defaultQosRegistry } from "../lib/providers/qos";
import { buildStatusProviders } from "../lib/providers/registry";

const router: IRouter = Router();

/**
 * Per-provider QoS stats for train status upstreams: request counts, outcomes,
 * latency (avg/p95), error rate, circuit-breaker state and the last failure.
 * Ops endpoint for watching each source independently during failover.
 */
router.get("/trains/providers", (_req, res) => {
  const providers = buildStatusProviders(process.env);
  const providersStatus = defaultQosRegistry.snapshotFor(
    providers.map((provider) => provider.name),
  );
  res.json({ providers: providersStatus });
});

export default router;
