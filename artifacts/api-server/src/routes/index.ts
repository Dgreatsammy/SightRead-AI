import { Router, type IRouter } from "express";
import healthRouter from "./health";
import omrRouter from "./omr";

const router: IRouter = Router();

router.use(healthRouter);
router.use(omrRouter);

export default router;
