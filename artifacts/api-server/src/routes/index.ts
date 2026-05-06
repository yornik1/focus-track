import { Router, type IRouter } from "express";
import healthRouter from "./health";
import focusRouter from "./focus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(focusRouter);

export default router;
