import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainEntry } from "@workspace/trains-data";
import type { TrainValidationState } from "@/lib/validation";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/recent-searches";
import { RecentSearchesProvider } from "@/context/recent-searches";
import { SearchBox } from "./search-box";

const CATALOG: TrainEntry[] = [
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "12951", name: "Mumbai Rajdhani Express" },
];

const RECENTS: TrainEntry[] = [
  { number: "12951", name: "Mumbai Rajdhani Express" },
  { number: "22943", name: "Indore Intercity SF Express" },
];

vi.mock("@/hooks/use-train-catalog", () => ({
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

  it("submits on Enter for a valid train and marks it valid", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("valid-train-number")).toBeInTheDocument();
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not nag while typing an unknown number, then errors on submit", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "99999");

    expect(
      screen.queryByTestId("error-train-number"),
    ).not.toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("error-train-number")).toBeInTheDocument();
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("submits via the button when valid", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "12951");
    await user.click(screen.getByTestId("submit-train-search"));

    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("clears the input via the clear button", async () => {
    const user = userEvent.setup();
    renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    expect(screen.getByTestId("input-train-number")).toHaveValue("22943");

    await user.click(screen.getByTestId("clear-train-number"));

    expect(screen.getByTestId("input-train-number")).toHaveValue("");
  });

  it("announces the suggestion count in a live region", async () => {
    const user = userEvent.setup();
    renderSearchBox();

    await user.type(screen.getByTestId("input-train-number"), "2294");

    expect(screen.getByTestId("search-results-count")).toBeInTheDocument();
  });
});

describe("SearchBox recents in dropdown", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(RECENTS));
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("shows recents when the input is empty and focused", async () => {
    const user = userEvent.setup();
    renderSearchBox();

    await user.click(screen.getByTestId("input-train-number"));

    expect(screen.getByTestId("search-recents")).toBeInTheDocument();
    expect(screen.getByTestId("recent-row-12951")).toBeInTheDocument();
    expect(screen.getByTestId("recent-row-22943")).toBeInTheDocument();
  });

  it("swaps recents for catalog suggestions once typing starts, and back on clear", async () => {
    const user = userEvent.setup();
    renderSearchBox();

    await user.click(screen.getByTestId("input-train-number"));
    expect(screen.getByTestId("recent-row-12951")).toBeInTheDocument();

    await user.type(screen.getByTestId("input-train-number"), "22");

    expect(screen.queryByTestId("recent-row-12951")).not.toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.clear(screen.getByTestId("input-train-number"));

    expect(screen.getByTestId("recent-row-12951")).toBeInTheDocument();
  });

  it("selecting a recent row reports the train and fills the input", async () => {
    const user = userEvent.setup();
    const handlers = renderSearchBox();

    await user.click(screen.getByTestId("input-train-number"));
    await user.click(screen.getByTestId("recent-row-22943"));

    expect(handlers.onSelectedChange).toHaveBeenCalledWith(CATALOG[0]);
    expect(screen.getByTestId("input-train-number")).toHaveValue("22943");
  });
});
