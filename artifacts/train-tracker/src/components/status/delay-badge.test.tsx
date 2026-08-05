import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { DelayBadge } from "./delay-badge";

function renderBadge(delayMinutes: number | null) {
  return render(
    <I18nProvider>
      <DelayBadge delayMinutes={delayMinutes} />
    </I18nProvider>
  );
}

describe("DelayBadge", () => {
  it("renders a late badge when delayMinutes > 0", () => {
    renderBadge(15);
    expect(screen.getByText("+15 min")).toBeInTheDocument();
    expect(screen.getByText("+15 min")).toHaveClass("bg-warning");
  });

  it("renders an on-time filled badge when delayMinutes is 0", () => {
    renderBadge(0);
    expect(screen.getByText("On time")).toBeInTheDocument();
    expect(screen.getByText("On time")).toHaveClass("bg-success");
    expect(screen.getByText("On time")).toHaveClass("text-success-foreground");
  });

  it("renders nothing when delayMinutes is null", () => {
    const { container } = renderBadge(null);
    expect(container).toBeEmptyDOMElement();
  });
});
