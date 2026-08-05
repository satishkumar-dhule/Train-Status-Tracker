import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { StatusMessage } from "./status-message";

describe("StatusMessage", () => {
  it("renders the message in an info banner", () => {
    render(
      <I18nProvider>
        <StatusMessage message="Train is running on time" />
      </I18nProvider>
    );
    const msg = screen.getByTestId("status-message");
    expect(msg).toBeInTheDocument();
    expect(msg.textContent).toBe("Train is running on time");
    expect(msg).toHaveClass("text-sm");
    expect(msg).toHaveClass("text-muted-foreground");
    expect(msg.querySelector("svg")).not.toBeNull();
  });

  it("renders nothing when message is null", () => {
    const { container } = render(
      <I18nProvider>
        <StatusMessage message={null} />
      </I18nProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
