import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, readdir, copyFile } from "node:fs/promises";
import { createJobRunner } from "../lib/web-job.ts";
import { readEnvConfig, writeEnvConfig, KNOWN_ENV_KEYS, type EnvKey } from "../lib/env-file.ts";
import { getYoutubeChannelInfo } from "./veo-to-youtube.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
const carsPoolPath = path.join(projectRoot, "data", "cars.json");
const carsQueuePath = path.join(projectRoot, "data", "cars-queue.json");
const outputDir = path.join(projectRoot, "output");
const publicDir = path.join(projectRoot, "public");

const port = Number(process.env.WEB_PORT ?? 3000);
const runner = createJobRunner();

function checkChromeInstalled(): boolean {
  if (process.platform === "darwin") {
    const homeDir = process.env.HOME || "";
    return (
      existsSync("/Applications/Google Chrome.app") ||
      existsSync(path.join(homeDir, "Applications/Google Chrome.app"))
    );
  } else if (process.platform === "win32") {
    const paths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    return paths.some((p) => existsSync(p));
  } else {
    return true;
  }
}

async function checkGeminiProfileLoggedIn(): Promise<boolean> {
  try {
    const profilePath = process.env.GEMINI_PROFILE_DIR
      ? path.resolve(projectRoot, process.env.GEMINI_PROFILE_DIR)
      : path.join(projectRoot, ".gemini-profile");
    if (!existsSync(profilePath)) return false;
    const files = await readdir(profilePath);
    return files.length > 0;
  } catch (e) {
    return false;
  }
}

const app = express();
app.use(express.json());
app.use(express.static(publicDir));
// express.static rejects path traversal / dotfile access by default, so this
// safely scopes video preview access to the output/ directory.
app.use("/media", express.static(outputDir));

app.get("/api/setup-status", async (_req, res) => {
  const envFileCreated = existsSync(envPath);
  const chromeInstalled = checkChromeInstalled();
  const geminiProfileLoggedIn = await checkGeminiProfileLoggedIn();

  const keysConfig: Record<string, { isSet: boolean; masked: string }> = {} as any;
  if (envFileCreated) {
    const read = await readEnvConfig(envPath);
    Object.assign(keysConfig, read);
  } else {
    for (const key of KNOWN_ENV_KEYS) {
      keysConfig[key] = { isSet: false, masked: "" };
    }
  }

  const requiredKeys: EnvKey[] = [
    "GEMINI_API_KEY",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
  ];

  const requiredKeysSet = requiredKeys.every((key) => keysConfig[key]?.isSet);

  res.json({
    envFileCreated,
    chromeInstalled,
    geminiProfileLoggedIn,
    requiredKeysSet,
    keysConfig,
  });
});

app.post("/api/setup/init-env", async (_req, res) => {
  try {
    if (existsSync(envPath)) {
      res.status(400).json({ error: "File .env đã tồn tại." });
      return;
    }
    const envExamplePath = path.join(projectRoot, ".env.example");
    if (!existsSync(envExamplePath)) {
      res.status(400).json({ error: "Không tìm thấy file .env.example mẫu." });
      return;
    }
    await copyFile(envExamplePath, envPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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

app.post("/api/reset", (req, res) => {
  if (runner.reset()) {
    res.json({ ok: true });
  } else {
    res.status(409).json({ error: "Không thể reset khi pipeline đang chạy." });
  }
});

app.get("/api/youtube-channel", async (req, res) => {
  try {
    const info = await getYoutubeChannelInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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
