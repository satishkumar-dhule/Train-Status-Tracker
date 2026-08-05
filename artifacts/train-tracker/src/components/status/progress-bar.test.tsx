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

  it("renders the two-sided journey progress strip", () => {
    render(
      <I18nProvider>
        <ProgressBar percent={40} sourceCode="ADI" destinationCode="BCT" />
      </I18nProvider>
    );
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill).toHaveStyle({ width: "40%" });
    expect(screen.getByText("40% of journey completed")).toBeInTheDocument();
    expect(screen.getByText("SOURCE")).toBeInTheDocument();
    expect(screen.getByText("ADI")).toBeInTheDocument();
    expect(screen.getByText("DESTINATION")).toBeInTheDocument();
    expect(screen.getByText("BCT")).toBeInTheDocument();
  });
});
