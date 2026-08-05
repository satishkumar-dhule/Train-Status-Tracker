import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trainsRouter from "./trains";
import trainCatalogRouter from "./train-catalog";
import trainRunsRouter from "./train-runs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainsRouter);
router.use(trainCatalogRouter);
router.use(trainRunsRouter);

export default router;
