import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { TrainEntry } from "@workspace/trains-data";
import { I18nProvider } from "../lib/i18n";
import { RecentSearchesProvider } from "../context/recent-searches";
import { RECENT_SEARCHES_STORAGE_KEY } from "../lib/recent-searches";
import { TrainNumberInput } from "./train-number-input";

(globalThis as { React: unknown }).React = React;

vi.mock("@workspace/api-client-react", () => ({
  getTrainCatalog: vi.fn(async () => ({
    trains: [
      { number: "22943", name: "Indore Intercity SF Express" },
      { number: "99901", name: "NTES Only Rocket" },
    ],
  })),
}));

vi.mock("./ui", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

function renderInput({
  initialValue = "",
  onSelectedChange,
}: {
  initialValue?: string;
  onSelectedChange?: (train: TrainEntry | null) => void;
} = {}) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <RecentSearchesProvider>
        <I18nProvider>
          <TrainNumberInput
            value={value}
            onValueChange={setValue}
            onSelectedChange={onSelectedChange}
          />
        </I18nProvider>
      </RecentSearchesProvider>
    );
  }
  return render(<Harness />);
}

describe("TrainNumberInput", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("opens the listbox when typing 5+ digits and picking a suggestion normalizes + persists it", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderInput({ onSelectedChange });
    const input = screen.getByRole("combobox");

    await user.type(input, "22943");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    const option = screen.getByRole("option", { name: /22943/ });
    await user.click(option);

    expect(input).toHaveValue("22943");
    expect(onSelectedChange).toHaveBeenLastCalledWith({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
    const stored = JSON.parse(
      localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) ?? "[]",
    );
    expect(stored).toContainEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("arrow-down highlights the first option, Enter selects it, and aria-activedescendant tracks it", async () => {
    const user = userEvent.setup();
    renderInput({ initialValue: "229" });
    const input = screen.getByRole("combobox");

    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    const first = options[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);

    await user.keyboard("{Enter}");
    expect(input).toHaveValue("22943");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("shows the error helper for invalid input", async () => {
    const user = userEvent.setup();
    renderInput();
    const input = screen.getByRole("combobox");

    await user.type(input, "2294");

    expect(screen.getByTestId("error-train-number")).toBeInTheDocument();
    expect(screen.getByTestId("status-invalid")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("Escape closes the listbox", async () => {
    const user = userEvent.setup();
    renderInput({ initialValue: "229" });
    const input = screen.getByRole("combobox");

    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("surfaces trains from the fetched NTES catalog in suggestions", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderInput({ onSelectedChange });
    const input = screen.getByRole("combobox");

    await user.type(input, "99901");

    const option = await screen.findByRole("option", {
      name: /NTES Only Rocket/,
    });
    await user.click(option);

    expect(input).toHaveValue("99901");
    expect(onSelectedChange).toHaveBeenLastCalledWith({
      number: "99901",
      name: "NTES Only Rocket",
    });
  });
});
