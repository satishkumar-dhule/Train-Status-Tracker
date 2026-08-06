import { describe, expect, it } from "vitest";
import {
  buildStatusProviders,
  DEFAULT_PROVIDER_ORDER,
} from "./registry";

describe("buildStatusProviders", () => {
  it("uses the default order when TRAIN_STATUS_PROVIDERS is unset", () => {
    const providers = buildStatusProviders({});
    // RailRadar is silently omitted without an API key.
    expect(providers.map((p) => p.name)).toEqual([
      "paytm",
      "goibibo",
      "railyatri",
      "whereismytrain",
      "easemytrip",
    ]);
    expect(providers.every((p) => p.enabled)).toBe(true);
  });

  it("includes railradar in the default order when a key is set", () => {
    const providers = buildStatusProviders({ RAILRADAR_API_KEY: "secret" });
    expect(providers.map((p) => p.name)).toEqual([...DEFAULT_PROVIDER_ORDER]);
  });

  it("respects an explicit order and drops unknown names", () => {
    const providers = buildStatusProviders({
      TRAIN_STATUS_PROVIDERS: "easemytrip,paytm,nonsense,goibibo",
    });
    expect(providers.map((p) => p.name)).toEqual([
      "easemytrip",
      "paytm",
      "goibibo",
    ]);
  });

  it("deduplicates repeated names", () => {
    const providers = buildStatusProviders({
      TRAIN_STATUS_PROVIDERS: "paytm,paytm,railyatri",
    });
    expect(providers.map((p) => p.name)).toEqual(["paytm", "railyatri"]);
  });

  it("returns an empty list when everything is unknown", () => {
    expect(buildStatusProviders({ TRAIN_STATUS_PROVIDERS: "bogus" })).toEqual(
      [],
    );
  });

  it("omits railradar without an api key", () => {
    const providers = buildStatusProviders({
      TRAIN_STATUS_PROVIDERS: "paytm,railradar",
    });
    expect(providers.map((p) => p.name)).toEqual(["paytm"]);
  });

  it("includes railradar when an api key is configured", () => {
    const providers = buildStatusProviders({
      TRAIN_STATUS_PROVIDERS: "railradar,paytm",
      RAILRADAR_API_KEY: "secret",
    });
    expect(providers.map((p) => p.name)).toEqual(["railradar", "paytm"]);
  });

  it("tolerates whitespace and case in the env list", () => {
    const providers = buildStatusProviders({
      TRAIN_STATUS_PROVIDERS: "  Paytm , GOIBIBO ",
    });
    expect(providers.map((p) => p.name)).toEqual(["paytm", "goibibo"]);
  });
});
