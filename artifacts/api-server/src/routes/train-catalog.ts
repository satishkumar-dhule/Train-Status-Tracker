import { Router, type IRouter } from "express";
import {
  GetTrainCatalogResponse,
  SearchTrainsQueryParams,
  SearchTrainsResponse,
} from "@workspace/api-zod";
import { getTrainCatalog, searchTrainCatalog } from "../lib/train-catalog";
import { zodErrorMessage } from "../lib/zod-errors";

/** Routes for the train catalog (numbers + names) used by autocomplete. */
const router: IRouter = Router();

router.get("/trains", async (_req, res): Promise<void> => {
  const trains = await getTrainCatalog();
  res.json(GetTrainCatalogResponse.parse({ trains }));
});

router.get("/trains/search", async (req, res): Promise<void> => {
  // Express 5's query parser returns arrays for repeated params (e.g.
  // `?q=a&q=b`), and the generated coerce schema would silently stringify
  // them. Reject missing and repeated params up front so they fail
  // validation with a clean message instead.
  const q = req.query.q;
  const limit = req.query.limit;
  if (q === undefined) {
    res.status(400).json({ error: "q: Required" });
    return;
  }
  if (Array.isArray(q)) {
    res.status(400).json({ error: "q: expected string, received array" });
    return;
  }
  if (Array.isArray(limit)) {
    res.status(400).json({ error: "limit: expected number, received array" });
    return;
  }

  const parsed = SearchTrainsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const { q: query, limit: queryLimit } = parsed.data;
  const results = await searchTrainCatalog(query, queryLimit);
  res.json(SearchTrainsResponse.parse({ results }));
});

export default router;
