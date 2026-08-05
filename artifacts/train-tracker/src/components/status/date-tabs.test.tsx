import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { DateTabs } from "./date-tabs";

const dates = [
  { iso: "2026-08-05", apiDate: "20260805", label: "Today" },
  { iso: "2026-08-06", apiDate: "20260806", label: "Tomorrow" },
  { iso: "2026-08-07", apiDate: "20260807", label: "7 Aug" },
];

function renderTabs(overrides: { active?: string; onChange?: () => void } = {}) {
  const onChange = overrides.onChange ?? (() => {});
  return render(
    <I18nProvider>
      <DateTabs dates={dates} active={overrides.active ?? "20260805"} onChange={onChange} />
    </I18nProvider>
  );
}

describe("DateTabs", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders every date with its label and an accessible group", () => {
    renderTabs();
    expect(screen.getByRole("group", { name: "Departure Date" })).toBeInTheDocument();
    expect(screen.getByTestId("tab-date-20260805")).toHaveTextContent("Today");
    expect(screen.getByTestId("tab-date-20260806")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("tab-date-20260807")).toHaveTextContent("7 Aug");
    expect(screen.getByTestId("tab-date-20260807")).toHaveAttribute("title", "2026-08-07");
  });

  it("renders the sub-line for tabs carrying a sub and omits it otherwise", () => {
    const subDates = [
      { iso: "2026-08-05", apiDate: "20260805", label: "Latest run", sub: "7 AUG" },
      { iso: "2026-08-06", apiDate: "20260806", label: "Next run", sub: "8 AUG" },
      { iso: "2026-08-07", apiDate: "20260807", label: "7 Aug" },
    ];
    render(
      <I18nProvider>
        <DateTabs dates={subDates} active="20260805" onChange={() => {}} />
      </I18nProvider>
    );

    expect(screen.getByTestId("tab-date-20260805")).toHaveTextContent("7 AUG");
    expect(screen.getByTestId("tab-date-20260806")).toHaveTextContent("8 AUG");
    expect(screen.getByTestId("tab-date-20260807").textContent).not.toContain("7 AUG");
    expect(screen.getByTestId("tab-date-20260807").textContent).not.toContain("8 AUG");
  });

  it("marks only the active tab as pressed", () => {
    renderTabs({ active: "20260806" });
    expect(screen.getByTestId("tab-date-20260806")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tab-date-20260805")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("tab-date-20260807")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the apiDate when a tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTabs({ onChange });
    await user.click(screen.getByTestId("tab-date-20260807"));
    expect(onChange).toHaveBeenCalledWith("20260807");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("scrolls the active tab into view when active changes", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(
      <I18nProvider>
        <DateTabs dates={dates} active="20260805" onChange={() => {}} />
      </I18nProvider>
    );
    rerender(
      <I18nProvider>
        <DateTabs dates={dates} active="20260807" onChange={() => {}} />
      </I18nProvider>
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "center" });
  });

  it("shows a right-edge fade overlay only when content overflows", () => {
    const proto = HTMLElement.prototype as unknown as {
      clientWidth?: number;
      scrollWidth?: number;
    };
    const originalClient = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const originalScroll = Object.getOwnPropertyDescriptor(proto, "scrollWidth");

    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => 400 });
    try {
      const { container } = renderTabs();
      expect(
        container.querySelector(".pointer-events-none.absolute.bg-gradient-to-l")
      ).not.toBeNull();
    } finally {
      if (originalClient) {
        Object.defineProperty(proto, "clientWidth", originalClient);
      } else {
        delete proto.clientWidth;
      }
      if (originalScroll) {
        Object.defineProperty(proto, "scrollWidth", originalScroll);
      } else {
        delete proto.scrollWidth;
      }
    }
  });

  it("omits the fade overlay when content fits", () => {
    const { container } = renderTabs();
    expect(container.querySelector(".bg-gradient-to-l")).toBeNull();
  });
});
