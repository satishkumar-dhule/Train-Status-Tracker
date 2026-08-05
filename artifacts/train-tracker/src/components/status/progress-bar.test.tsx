import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("renders nothing when percent is null", () => {
    const { container } = render(
      <I18nProvider>
        <ProgressBar percent={null} sourceCode="ADI" destinationCode="BCT" />
      </I18nProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the fill with a percent width and source → dest labels", () => {
    render(
      <I18nProvider>
        <ProgressBar percent={40} sourceCode="ADI" destinationCode="BCT" />
      </I18nProvider>
    );
    const fill = screen.getByTestId("progress-bar");
    expect(fill).toHaveStyle({ width: "40%" });
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("ADI → BCT")).toBeInTheDocument();
  });
});
