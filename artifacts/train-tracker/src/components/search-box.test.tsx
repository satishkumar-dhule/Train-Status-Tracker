import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainEntry } from "@workspace/trains-data";
import type { TrainValidationState } from "../lib/validation";
import { RecentSearchesProvider } from "../context/recent-searches";
import { SearchBox } from "./search-box";

const CATALOG: TrainEntry[] = [
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "12951", name: "Mumbai Rajdhani Express" },
];

vi.mock("../hooks/use-train-catalog", () => ({
  useTrainCatalog: () => ({ trains: CATALOG, isLoading: false, isError: false }),
}));

function renderSearchBox() {
  const handlers = {
    onSelectedChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  function Harness() {
    const [value, setValue] = useState("");
    const [, setValidity] = useState<TrainValidationState>({ status: "idle" });
    return (
      <SearchBox
        value={value}
        onValueChange={setValue}
        onValidityChange={setValidity}
        onSelectedChange={handlers.onSelectedChange}
        onSubmit={handlers.onSubmit}
      />
    );
  }

  render(
    <RecentSearchesProvider>
      <Harness />
    </RecentSearchesProvider>,
  );
  return handlers;
}

describe("SearchBox", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the input, search button, and hint", () => {
    renderSearchBox();

    expect(screen.getByTestId("input-train-number")).toBeInTheDocument();
    expect(screen.getByTestId("submit-train-search")).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("shows suggestions while typing and reports the selected train", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "2294");

    const option = await screen.findByRole("option", {
      name: /Indore Intercity SF Express/,
    });
    await user.click(option);

    expect(handlers.onSelectedChange).toHaveBeenCalledWith(CATALOG[0]);
    expect(screen.getByTestId("input-train-number")).toHaveValue("22943");
  });

  it("marks a valid train as valid and submits on Enter", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("valid-train-number")).toBeInTheDocument();
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows an error for an unknown number and does not submit", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "99999");

    expect(await screen.findByTestId("error-train-number")).toBeInTheDocument();
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("clears the input via the clear button", async () => {
    const user = userEvent.setup();
    renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    expect(screen.getByTestId("input-train-number")).toHaveValue("22943");

    await user.click(screen.getByTestId("clear-train-number"));

    expect(screen.getByTestId("input-train-number")).toHaveValue("");
  });

  it("submits via the button when valid", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "12951");
    await user.click(screen.getByTestId("submit-train-search"));

    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });
});
