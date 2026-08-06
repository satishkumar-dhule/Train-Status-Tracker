import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getRedisHealthState } from "../lib/redis-client";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    redis: getRedisHealthState(),
    uptime_seconds: Math.floor(process.uptime()),
    version: process.env.SERVICE_VERSION ?? null,
    timestamp: new Date().toISOString(),
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(data);
});

export default router;
