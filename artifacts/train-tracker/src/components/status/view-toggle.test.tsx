import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { ViewToggle } from "./view-toggle";

describe("ViewToggle", () => {
  it("renders both options with the active one pressed", () => {
    render(
      <I18nProvider>
        <ViewToggle value="timeline" onChange={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("view-toggle")).toBeInTheDocument();
    const timeline = screen.getByTestId("view-timeline");
    const track = screen.getByTestId("view-track");
    expect(timeline).toHaveAttribute("aria-pressed", "true");
    expect(track).toHaveAttribute("aria-pressed", "false");
    expect(timeline).toHaveTextContent("Timeline");
    expect(track).toHaveTextContent("Live track");
  });

  it("calls onChange when an option is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <ViewToggle value="timeline" onChange={onChange} />
      </I18nProvider>,
    );

    await user.click(screen.getByTestId("view-track"));
    expect(onChange).toHaveBeenCalledWith("track");
  });
});
