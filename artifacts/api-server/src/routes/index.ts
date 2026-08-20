import { Router, type IRouter } from "express";
import healthRouter from "./health";
import focusRouter from "./focus";
import habitsRouter from "./habits";

const router: IRouter = Router();

router.use(healthRouter);
router.use(focusRouter);
router.use(habitsRouter);

router.use((_req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

export default router;
