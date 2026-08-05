import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { DisplaySettings } from "./display-settings";
import { DISPLAY_PREFERENCES_STORAGE_KEY } from "@/hooks/use-display-preferences";

function renderDisplaySettings() {
  return render(
    <I18nProvider>
      <DisplaySettings />
    </I18nProvider>,
  );
}

function modeClasses(): string[] {
  return [...document.documentElement.classList].filter((c) =>
    c.startsWith("mode-"),
  );
}

describe("DisplaySettings", () => {
  beforeEach(() => {
    document.documentElement.classList.remove(
      "mode-high-contrast",
      "mode-big-fonts",
      "mode-bw",
    );
    localStorage.clear();
  });

  it("applies a display mode, persists it, and marks it pressed", async () => {
    const user = userEvent.setup();
    renderDisplaySettings();

    await user.click(screen.getByTestId("button-display-settings"));

    expect(screen.getByTestId("display-settings-popover")).toBeInTheDocument();
    expect(screen.getByTestId("display-mode-high-contrast")).toBeInTheDocument();
    expect(screen.getByTestId("display-mode-big-fonts")).toBeInTheDocument();
    expect(screen.getByTestId("display-mode-bw")).toBeInTheDocument();

    await user.click(screen.getByTestId("display-mode-high-contrast"));

    expect(document.documentElement).toHaveClass("mode-high-contrast");
    expect(modeClasses()).toEqual(["mode-high-contrast"]);
    expect(localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(
      "high-contrast",
    );

    await user.click(screen.getByTestId("button-display-settings"));
    await user.click(screen.getByTestId("display-mode-bw"));

    expect(document.documentElement).toHaveClass("mode-bw");
    expect(modeClasses()).toEqual(["mode-bw"]);
    expect(localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)).toBe("bw");

    await user.click(screen.getByTestId("button-display-settings"));
    await user.click(screen.getByTestId("display-mode-default"));

    expect(modeClasses()).toEqual([]);
    expect(localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(
      "default",
    );
  });

  it("re-applies a stored display mode on mount", () => {
    localStorage.setItem(DISPLAY_PREFERENCES_STORAGE_KEY, "big-fonts");
    renderDisplaySettings();

    expect(document.documentElement).toHaveClass("mode-big-fonts");
    expect(modeClasses()).toEqual(["mode-big-fonts"]);
  });
});
