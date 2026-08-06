import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { RefreshControls } from "./refresh-controls";

function renderControls(
  props: Partial<{
    isFetching: boolean;
    autoRefresh: boolean;
    onRefresh: () => void;
    onAutoRefreshChange: (enabled: boolean) => void;
  }> = {},
) {
  return render(
    <I18nProvider>
      <RefreshControls
        isFetching={props.isFetching ?? false}
        autoRefresh={props.autoRefresh ?? false}
        onRefresh={props.onRefresh ?? (() => {})}
        onAutoRefreshChange={props.onAutoRefreshChange ?? (() => {})}
      />
    </I18nProvider>,
  );
}

describe("RefreshControls", () => {
  it("renders the refresh button and the auto-refresh switch", () => {
    renderControls();

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh")).toBeInTheDocument();
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    renderControls({ onRefresh });

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the refresh button while a fetch is in flight", () => {
    renderControls({ isFetching: true });

    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });

  it("reflects the checked state and reports changes", async () => {
    const onAutoRefreshChange = vi.fn();
    const user = userEvent.setup();
    renderControls({ autoRefresh: true, onAutoRefreshChange });

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("data-state", "checked");

    await user.click(toggle);

    expect(onAutoRefreshChange).toHaveBeenCalledWith(false);
  });
});
