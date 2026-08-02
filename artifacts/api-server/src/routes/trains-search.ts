import { Router, type IRouter } from "express";
import { SearchTrainsQueryParams, SearchTrainsResponse } from "@workspace/api-zod";
import { searchTrains } from "../lib/trains-data";

const router: IRouter = Router();

router.get("/trains/search", async (req, res): Promise<void> => {
  const parsed = SearchTrainsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q } = parsed.data;
  const results = searchTrains(q);

  res.json(SearchTrainsResponse.parse({ results }));
});

export default router;
