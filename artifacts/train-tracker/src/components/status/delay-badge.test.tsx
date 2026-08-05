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
    expect(screen.getByText("15M late")).toBeInTheDocument();
    expect(screen.getByText("15M late")).toHaveClass("bg-warning");
  });

  it("renders an on-time outline badge when delayMinutes is 0", () => {
    renderBadge(0);
    expect(screen.getByText("On time")).toBeInTheDocument();
    expect(screen.getByText("On time")).toHaveClass("border-success");
  });

  it("renders nothing when delayMinutes is null", () => {
    const { container } = renderBadge(null);
    expect(container).toBeEmptyDOMElement();
  });
});
