import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GatewaySelector, GATEWAY_AUTO } from "./gateway-selector";

describe("GatewaySelector", () => {
  const gateways = ["paytm", "whereismytrain", "goibibo"];

  it("offers Auto (failover) plus one option per enabled gateway", () => {
    render(
      <GatewaySelector
        gateways={gateways}
        value={GATEWAY_AUTO}
        onChange={() => {}}
      />,
    );

    const select = screen.getByTestId("select-gateway") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.text);
    expect(options).toEqual([
      "Auto (failover)",
      "Paytm",
      "WhereIsMyTrain",
      "Goibibo",
    ]);
    expect(select).toHaveValue(GATEWAY_AUTO);
  });

  it("shows only Auto when no gateways are reported", () => {
    render(
      <GatewaySelector
        gateways={[]}
        value={GATEWAY_AUTO}
        onChange={() => {}}
      />,
    );

    const select = screen.getByTestId("select-gateway") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0]).toHaveValue(GATEWAY_AUTO);
  });

  it("reports the chosen gateway via onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GatewaySelector
        gateways={gateways}
        value={GATEWAY_AUTO}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByTestId("select-gateway"), "paytm");

    expect(onChange).toHaveBeenCalledWith("paytm");
  });
});
