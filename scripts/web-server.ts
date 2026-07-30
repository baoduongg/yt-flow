import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createJobRunner } from "../lib/web-job.ts";
import { readEnvConfig, writeEnvConfig, KNOWN_ENV_KEYS, type EnvKey } from "../lib/env-file.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
const carsPoolPath = path.join(projectRoot, "data", "cars.json");
const carsQueuePath = path.join(projectRoot, "data", "cars-queue.json");
const outputDir = path.join(projectRoot, "output");
const publicDir = path.join(projectRoot, "public");

const port = Number(process.env.WEB_PORT ?? 3000);
const runner = createJobRunner();

const app = express();
app.use(express.json());
app.use(express.static(publicDir));
// express.static rejects path traversal / dotfile access by default, so this
// safely scopes video preview access to the output/ directory.
app.use("/media", express.static(outputDir));

app.get("/api/config", async (_req, res) => {
  res.json(await readEnvConfig(envPath));
});

app.post("/api/config", async (req, res) => {
  const updates: Partial<Record<EnvKey, string>> = {};
  for (const key of KNOWN_ENV_KEYS) {
    const value = req.body?.[key];
    if (typeof value === "string") updates[key] = value;
  }

  try {
    const merged = await writeEnvConfig(envPath, updates);
    Object.assign(process.env, merged);
    res.json(await readEnvConfig(envPath));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/cars", async (_req, res) => {
  const pool = JSON.parse(await readFile(carsPoolPath, "utf-8")) as string[];
  const queue = await readFile(carsQueuePath, "utf-8")
    .then((raw) => JSON.parse(raw) as string[])
    .catch(() => [] as string[]);
  res.json({ pool, queue });
});

app.post("/api/generate", (req, res) => {
  const car = typeof req.body?.car === "string" && req.body.car.trim() ? req.body.car.trim() : undefined;
  const started = runner.start(car);
  res.status(started ? 202 : 409).json(runner.getState());
});

app.post("/api/video-decision", (req, res) => {
  const approved = req.body?.approved === true;
  if (!runner.decideVideo(approved)) {
    res.status(409).json({ error: "Không có video nào đang chờ duyệt." });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/metadata-decision", (req, res) => {
  const { title, description, tags } = req.body ?? {};
  if (typeof title !== "string" || typeof description !== "string" || !Array.isArray(tags)) {
    res.status(400).json({ error: "Thiếu title/description/tags hợp lệ." });
    return;
  }
  if (!runner.decideMetadata({ title, description, tags: tags.map(String) })) {
    res.status(409).json({ error: "Không có metadata nào đang chờ duyệt." });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (state: ReturnType<typeof runner.getState>) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  send(runner.getState());
  const unsubscribe = runner.subscribe(send);
  req.on("close", unsubscribe);
});

app.listen(port, "127.0.0.1", () => {
  console.log(`yt-flow web dashboard: http://127.0.0.1:${port}`);
});
