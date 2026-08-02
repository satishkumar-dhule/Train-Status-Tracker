import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trainsRouter from "./trains";
import trainsSearchRouter from "./trains-search";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainsSearchRouter);
router.use(trainsRouter);

export default router;
