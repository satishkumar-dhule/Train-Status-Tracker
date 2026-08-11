import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, Card, Label, LiveRegion, Pill, Skeleton, Stat } from "./index";

describe("Button", () => {
  it.each(["primary", "secondary", "outline", "ghost", "danger"] as const)(
    "renders the %s variant",
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(
        screen.getByRole("button", { name: "Action" }),
      ).toBeInTheDocument();
    },
  );

  it("forwards the ref, type, disabled, aria and data-testid props", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        ref={ref}
        variant="outline"
        aria-pressed
        aria-expanded
        aria-label="Invert colors"
        disabled
        data-testid="button-test"
      >
        Toggle
      </Button>,
    );

    const button = screen.getByTestId("button-test");
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-label", "Invert colors");
    expect(button).toBeDisabled();
  });

  it("defaults type to button but honors an explicit type", () => {
    const { rerender } = render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "type",
      "button",
    );

    rerender(<Button type="submit">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "type",
      "submit",
    );
  });
});

describe("Card", () => {
  it("renders a div by default with md padding", () => {
    const { container } = render(<Card>Body</Card>);
    const card = container.firstElementChild;
    expect(card?.tagName).toBe("DIV");
    expect(card).toHaveClass("rounded-xl", "border", "bg-card", "p-4");
  });

  it("honors the as and padding props", () => {
    const { container, rerender } = render(
      <Card as="section" padding="lg">
        Body
      </Card>,
    );
    expect(container.firstElementChild?.tagName).toBe("SECTION");
    expect(container.firstElementChild).toHaveClass("p-6");

    rerender(
      <Card as="article" padding="none">
        Body
      </Card>,
    );
    expect(container.firstElementChild?.tagName).toBe("ARTICLE");
    expect(container.firstElementChild).not.toHaveClass("p-6", "p-4", "p-3");
  });
});

describe("Label", () => {
  it("renders text with the mono uppercase treatment", () => {
    render(<Label>Current station</Label>);
    const label = screen.getByText("Current station");
    expect(label.tagName).toBe("SPAN");
    expect(label).toHaveClass(
      "font-mono",
      "text-[10px]",
      "uppercase",
      "tracking-widest",
    );
  });

  it("switches the tone between default and muted", () => {
    const { rerender } = render(<Label tone="muted">Muted</Label>);
    expect(screen.getByText("Muted")).toHaveClass("text-muted-foreground");

    rerender(<Label>Default</Label>);
    expect(screen.getByText("Default")).toHaveClass("text-foreground");
  });
});

describe("Pill", () => {
  it("applies the variant fill classes", () => {
    const { rerender } = render(<Pill variant="on-time">On time</Pill>);
    expect(screen.getByText("On time")).toHaveClass(
      "bg-on-time",
      "text-on-time-fg",
      "border-on-time",
    );

    rerender(<Pill variant="late">Late</Pill>);
    expect(screen.getByText("Late")).toHaveClass(
      "bg-late",
      "text-late-fg",
      "border-late",
    );

    rerender(<Pill variant="cancelled">Cancelled</Pill>);
    expect(screen.getByText("Cancelled")).toHaveClass(
      "bg-cancelled",
      "text-cancelled-fg",
      "border-cancelled",
    );
  });

  it("renders a matching icon for on-time, late and cancelled", () => {
    const { container, rerender } = render(
      <Pill variant="on-time">On time</Pill>,
    );
    expect(container.querySelector("svg")).not.toBeNull();

    rerender(<Pill variant="late">Late</Pill>);
    expect(container.querySelector("svg")).not.toBeNull();

    rerender(<Pill variant="cancelled">Cancelled</Pill>);
    expect(container.querySelector("svg")).not.toBeNull();

    rerender(<Pill variant="neutral">Neutral</Pill>);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("lets callers override the icon", () => {
    render(
      <Pill variant="neutral" icon={<span data-testid="custom-icon">•</span>}>
        Custom
      </Pill>,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("applies role=status only when announce", () => {
    const { rerender } = render(<Pill variant="on-time">On time</Pill>);
    expect(screen.getByText("On time")).not.toHaveAttribute("role");

    rerender(
      <Pill variant="on-time" announce>
        On time
      </Pill>,
    );
    expect(screen.getByText("On time")).toHaveAttribute("role", "status");
    expect(screen.getByText("On time")).toHaveAttribute("aria-live", "polite");
  });

  it("forwards a testId", () => {
    render(
      <Pill variant="info" testId="pill-test">
        Info
      </Pill>,
    );
    expect(screen.getByTestId("pill-test")).toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("renders the label, value and sub", () => {
    render(<Stat label="Delay" value="45 min" sub="vs schedule" />);
    expect(screen.getByText("Delay")).toHaveClass(
      "uppercase",
      "tracking-widest",
    );
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("vs schedule")).toBeInTheDocument();
  });

  it("renders the hero value at text-5xl and the plain value at text-2xl", () => {
    const { rerender } = render(<Stat label="Delay" value="On time" hero />);
    expect(screen.getByText("On time")).toHaveClass(
      "text-5xl",
      "font-bold",
      "tracking-tight",
    );

    rerender(<Stat label="Stations" value="12" />);
    expect(screen.getByText("12")).toHaveClass("text-2xl");
    expect(screen.getByText("12")).not.toHaveClass("text-5xl");
  });

  it("applies the tone classes to the value", () => {
    const { rerender } = render(
      <Stat label="Latency" value="12 ms" tone="success" />,
    );
    expect(screen.getByText("12 ms")).toHaveClass("text-success");

    rerender(<Stat label="Latency" value="120 ms" tone="warning" />);
    expect(screen.getByText("120 ms")).toHaveClass("text-warning");

    rerender(<Stat label="Latency" value="ERR" tone="destructive" />);
    expect(screen.getByText("ERR")).toHaveClass("text-destructive");

    rerender(<Stat label="Latency" value="--" tone="muted" />);
    expect(screen.getByText("--")).toHaveClass("text-muted-foreground");
  });

  it("forwards the testId", () => {
    render(<Stat label="Uptime" value="99.9%" testId="stat-test" />);
    expect(screen.getByTestId("stat-test")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("renders the requested number of lines", () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(container.querySelectorAll(".h-4")).toHaveLength(4);
  });

  it("defaults to three lines", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll(".h-4")).toHaveLength(3);
  });

  it("marks the wrapper aria-hidden unless a testId is set", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");

    const { container: withId } = render(<Skeleton testId="status-skeleton" />);
    expect(withId.firstElementChild).not.toHaveAttribute("aria-hidden");
    expect(withId.firstElementChild).toHaveAttribute(
      "data-testid",
      "status-skeleton",
    );
  });
});

describe("LiveRegion", () => {
  it("renders a polite status region that is screen-reader only", () => {
    render(<LiveRegion label="Suggestions">6 suggestions for 229</LiveRegion>);
    const region = screen.getByText("6 suggestions for 229");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-label", "Suggestions");
    expect(region).toHaveClass("sr-only");
  });
});
