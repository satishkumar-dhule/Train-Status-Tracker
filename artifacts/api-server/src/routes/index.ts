import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trainsRouter from "./trains";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainsRouter);

export default router;
