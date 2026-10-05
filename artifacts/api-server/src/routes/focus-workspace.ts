import { Router, type NextFunction, type Request, type Response } from "express";
import {
  FocusWorkspaceError,
  archiveDirection,
  cancelFocusWorkSession,
  createDirection,
  finishFocusWorkSession,
  focusWorkspaceEnabled,
  getFocusSessionDetails,
  getFocusWorkspaceState,
  saveFocusReflection,
  startFocusWorkSession,
  updateDirection,
} from "@workspace/db";

const router = Router();

function bodyRecord(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new FocusWorkspaceError("request body must be an object", 400);
  }
  return req.body as Record<string, unknown>;
}

function handler(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      fn(req, res);
    } catch (error) {
      next(error);
    }
  };
}

router.get("/focus-workspace/availability", (_req, res) => {
  res.json({ enabled: focusWorkspaceEnabled() });
});

router.use("/focus-workspace", (_req, res, next) => {
  if (!focusWorkspaceEnabled()) return res.status(404).json({ success: false, message: "API route not found" });
  return next();
});

router.get("/focus-workspace/state", handler((_req, res) => res.json(getFocusWorkspaceState())));

router.post("/focus-workspace/directions", handler((req, res) => {
  res.status(201).json(createDirection(bodyRecord(req)));
}));

router.patch("/focus-workspace/directions/:id", handler((req, res) => {
  res.json(updateDirection(String(req.params.id), bodyRecord(req)));
}));

router.post("/focus-workspace/directions/:id/archive", handler((req, res) => {
  res.json(archiveDirection(String(req.params.id)));
}));

router.post("/focus-workspace/sessions", handler((req, res) => {
  res.status(201).json(startFocusWorkSession(bodyRecord(req)));
}));

router.post("/focus-workspace/sessions/:id/finish", handler((req, res) => {
  res.json(finishFocusWorkSession(String(req.params.id)));
}));

router.post("/focus-workspace/sessions/:id/cancel", handler((req, res) => {
  res.json(cancelFocusWorkSession(String(req.params.id)));
}));

router.get("/focus-workspace/sessions/:id", handler((req, res) => {
  res.json(getFocusSessionDetails(String(req.params.id)));
}));

router.patch("/focus-workspace/sessions/:id/reflection", handler((req, res) => {
  res.json(saveFocusReflection(String(req.params.id), bodyRecord(req)));
}));

router.use("/focus-workspace", (error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!(error instanceof FocusWorkspaceError)) return next(error);
  return res.status(error.status).json({
    success: false,
    message: error.message,
    ...(error.current ? { current_session: error.current } : {}),
  });
});

export default router;

