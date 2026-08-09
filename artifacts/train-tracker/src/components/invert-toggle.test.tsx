import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvertToggle } from "./invert-toggle";
import { INVERT_STORAGE_KEY } from "../hooks/use-inverted";

describe("InvertToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("inverted");
    localStorage.clear();
  });

  it("renders a non-inverted toggle initially", () => {
    render(<InvertToggle />);

    const button = screen.getByTestId("button-invert");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("inverts on click and persists", async () => {
    const user = userEvent.setup();
    render(<InvertToggle />);

    await user.click(screen.getByTestId("button-invert"));

    expect(document.documentElement).toHaveClass("inverted");
    expect(screen.getByTestId("button-invert")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem(INVERT_STORAGE_KEY)).toBe("true");
  });

  it("un-inverts on a second click", async () => {
    const user = userEvent.setup();
    render(<InvertToggle />);

    const button = screen.getByTestId("button-invert");
    await user.click(button);
    await user.click(button);

    expect(document.documentElement).not.toHaveClass("inverted");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem(INVERT_STORAGE_KEY)).toBe("false");
  });
});
