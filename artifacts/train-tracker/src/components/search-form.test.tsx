import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { TrainValidationState } from "../lib/validation";
import { I18nProvider } from "../lib/i18n";
import { RecentSearchesProvider } from "../context/recent-searches";
import { SearchForm } from "./search-form";

(globalThis as { React: unknown }).React = React;

vi.mock("./ui", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

function renderForm({
  initialValue = "",
  onSubmit = () => {},
  compact,
  autoFocus,
  onValidityChange,
}: {
  initialValue?: string;
  onSubmit?: () => void;
  compact?: boolean;
  autoFocus?: boolean;
  onValidityChange?: (state: TrainValidationState) => void;
} = {}) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <RecentSearchesProvider>
        <I18nProvider>
          <SearchForm
            value={value}
            onValueChange={setValue}
            onSubmit={onSubmit}
            compact={compact}
            autoFocus={autoFocus}
            onValidityChange={onValidityChange}
          />
        </I18nProvider>
      </RecentSearchesProvider>
    );
  }
  return render(<Harness />);
}

describe("SearchForm", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the input and a submit button disabled while empty/idle", () => {
    renderForm({ onSubmit: vi.fn() });

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    const submit = screen.getByTestId("submit-train-search");
    expect(submit).toBeInTheDocument();
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
  });

  it("enables the submit button only for a valid train number and fires onSubmit once on click", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    const input = screen.getByRole("combobox");
    const submit = screen.getByTestId("submit-train-search");

    await user.type(input, "2294");
    expect(submit).toHaveAttribute("aria-disabled", "true");
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(input, "3");
    expect(submit).toHaveAttribute("aria-disabled", "false");
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter in the input with no highlighted option submits the form when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    const input = screen.getByRole("combobox");

    await user.type(input, "22943");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter with a highlighted suggestion selects it instead of submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    const input = screen.getByRole("combobox");

    await user.type(input, "229");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue("22943");
  });

  it("compact renders with the compact marker and smaller button sizing", () => {
    renderForm({ compact: true });

    const form = screen.getByTestId("search-form");
    expect(form).toHaveAttribute("data-compact", "true");
    const submit = screen.getByTestId("submit-train-search");
    expect(submit).toHaveClass("h-10");
    expect(submit).not.toHaveClass("h-14");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("compact suppresses the validation hint so the form stays a single row", async () => {
    const user = userEvent.setup();
    renderForm({ compact: true });

    await user.type(screen.getByRole("combobox"), "22943");

    expect(screen.queryByTestId("valid-train-number")).not.toBeInTheDocument();
    expect(screen.queryByTestId("error-train-number")).not.toBeInTheDocument();
  });
});
