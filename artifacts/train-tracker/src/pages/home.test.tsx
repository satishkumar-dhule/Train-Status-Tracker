import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecentSearchesProvider } from "@/context/recent-searches";
import { RECENT_SEARCHES_STORAGE_KEY } from "@/lib/recent-searches";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Home from "./Home";

vi.mock("@/features/journey/journey-view", () => ({
  JourneyView: ({ trainNumber }: { trainNumber: string | null }) => (
    <div data-testid="journey-view" data-train-number={trainNumber ?? ""}>
      {trainNumber}
    </div>
  ),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    getTrainCatalog: vi.fn(async () => ({
      trains: [
        { number: "22943", name: "Indore Intercity SF Express" },
        { number: "12951", name: "Mumbai Rajdhani Express" },
      ],
    })),
  };
});

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const memory = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecentSearchesProvider>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <Home />
        </Router>
      </RecentSearchesProvider>
    </QueryClientProvider>,
  );
}

/** Type a train number into the page-1 input and submit with Enter. */
async function searchFor(
  user: ReturnType<typeof userEvent.setup>,
  number: string,
) {
  await user.type(screen.getByTestId("input-train-number"), number);
  await user.keyboard("{Enter}");
}

describe("Home", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("inverted");
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it("renders the search page initially: title, input, submit, monitoring nav, no journey view", () => {
    renderHome();

    expect(screen.getByTestId("search-title")).toBeInTheDocument();
    expect(screen.getByTestId("input-train-number")).toBeInTheDocument();
    expect(screen.getByTestId("submit-train-search")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-monitoring")).toBeInTheDocument();
    expect(screen.queryByTestId("journey-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recent-searches")).not.toBeInTheDocument();
  });

  it("does not navigate while typing; submits only on Enter", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "22943");

    expect(screen.queryByTestId("journey-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-train-number")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");

    const journey = await screen.findByTestId("journey-view");
    expect(journey).toHaveAttribute("data-train-number", "22943");
    expect(screen.getByTestId("header-train-number")).toHaveTextContent(
      "22943",
    );
  });

  it("submits when the search button is clicked", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "22943");
    await user.click(screen.getByTestId("submit-train-search"));

    expect(await screen.findByTestId("journey-view")).toHaveAttribute(
      "data-train-number",
      "22943",
    );
  });

  it("submits immediately when a train is picked from the autocomplete list", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId("input-train-number"), "2294");
    const option = await screen.findByRole("option", {
      name: /Indore Intercity SF Express/,
    });
    await user.click(option);

    expect(await screen.findByTestId("journey-view")).toHaveAttribute(
      "data-train-number",
      "22943",
    );
  });

  it("loads a recent chip click and submits it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([{ number: "12951", name: "Mumbai Rajdhani Express" }]),
    );
    renderHome();

    expect(screen.getByTestId("recent-chip-12951")).toBeInTheDocument();
    expect(screen.getByTestId("recent-chip-name-12951")).toHaveTextContent(
      "Mumbai Rajdhani Express",
    );

    await user.click(screen.getByTestId("recent-chip-12951"));

    expect(await screen.findByTestId("journey-view")).toHaveAttribute(
      "data-train-number",
      "12951",
    );
  });

  it("back button returns to the search page", async () => {
    const user = userEvent.setup();
    renderHome();

    await searchFor(user, "22943");
    await screen.findByTestId("journey-view");

    await user.click(screen.getByTestId("button-new-search"));

    expect(screen.getByTestId("search-title")).toBeInTheDocument();
    expect(screen.queryByTestId("journey-view")).not.toBeInTheDocument();
  });

  it("inverts the site from the header toggle", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByTestId("button-invert"));

    expect(document.documentElement).toHaveClass("inverted");
    expect(screen.getByTestId("button-invert")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the monitoring nav link on the search page", () => {
    renderHome();

    expect(screen.getByTestId("nav-link-monitoring")).toBeInTheDocument();
  });
});
