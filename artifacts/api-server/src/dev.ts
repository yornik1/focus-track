import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import app from "./app";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "../../focus-tracker");

const port = Number(process.env["PORT"] || "5001");

async function start() {
  const server = express();

  // API роуты первыми
  server.use(app);

  // Vite dev server как middleware
  const vite = await createViteServer({
    root: frontendRoot,
    server: {
      middlewareMode: true,
      hmr: { port: 24679 },
    },
    appType: "spa",
  });

  server.use(vite.middlewares);

  server.listen(port, () => {
    logger.info({ port }, "Dev server ready (API + Vite HMR)");
  });
}

start();
