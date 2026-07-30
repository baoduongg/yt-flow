# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local web dashboard (Express + vanilla JS) that lets a user set `.env` keys, pick/generate a car video, preview it, approve/reject it, edit generated YouTube metadata, and trigger upload — reusing `lib/pipeline.ts` exactly as the CLI and Telegram bot do.

**Architecture:** One new Express server (`scripts/web-server.ts`) wires two new pure/testable modules — `lib/env-file.ts` (parse/mask/write `.env`) and `lib/web-job.ts` (in-memory job state machine wrapping `runPipeline`) — to a single-page vanilla-JS frontend (`public/`) via REST endpoints + Server-Sent Events. `lib/pipeline.ts` gets one new optional hook, `confirmMetadata`, so CLI/bot behavior is unchanged.

**Tech Stack:** Node.js (`v24`, ESM, `tsx` for `.ts` execution — no build step), Express 4 (+ `@types/express`), vanilla HTML/CSS/JS for the frontend (no framework, no bundler), `node:test` for unit tests.

## Global Constraints

- Only new runtime dependency: `express` (+ `@types/express` as devDependency). No other framework, no bundler, no build step for `public/`.
- Server binds `127.0.0.1` only, port from `WEB_PORT` env var (default `3000`). No auth — local single-user tool.
- `confirmMetadata` hook on `PipelineHooks` must be **optional**. `scripts/run-shorts-pipeline.ts` and `scripts/telegram-bot.ts` must keep working unmodified and unchanged in behavior.
- Only one pipeline job runs at a time. Starting a new one while busy returns HTTP `409`.
- `GET /api/config` never returns plaintext secret values — only `{ isSet: boolean, masked: string }` per key, masked as `first4 + "****" + last4` (or all `*` if the value is 8 chars or shorter).
- `POST /api/config`: an empty/missing field means "keep existing value" (never overwrites with blank).
- Follow existing repo conventions: ESM imports with explicit `.ts` extensions (`allowImportingTsExtensions` is on), Vietnamese user-facing strings (matches `lib/pipeline.ts`, `scripts/telegram-bot.ts`), `node:test` + `node:assert/strict` for tests (matches `lib/pipeline.test.ts`).

---

### Task 1: `confirmMetadata` hook on the pipeline core

**Files:**
- Modify: `lib/pipeline.ts:12-15` (hook type), `lib/pipeline.ts:76-84` (call site)
- Modify: `lib/pipeline.test.ts` (append new test)

**Interfaces:**
- Produces: `PipelineHooks.confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>` — optional; when omitted, `runPipeline` uploads the metadata `generateMetadata` returned, unchanged from current behavior.

- [ ] **Step 1: Write the failing test**

Append to `lib/pipeline.test.ts` (before the final closing of the file, as a new `test(...)` block alongside the existing three):

```ts
test("confirmMetadata edits metadata before upload", async () => {
  const deps = makeDeps();
  const uploaded: VideoMetadata[] = [];
  deps.uploadToYoutube = async (_path, meta) => {
    uploaded.push(meta);
    return "https://youtu.be/edited";
  };

  const result = await runPipeline(
    {},
    {
      confirmVideo: async () => true,
      confirmMetadata: async (meta) => ({ ...meta, title: "Edited Title" }),
    },
    deps,
  );

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].title, "Edited Title");
  assert.equal(result.videoUrl, "https://youtu.be/edited");
});
```

Add the missing import at the top of `lib/pipeline.test.ts`:

```ts
import type { VideoMetadata } from "./generate-metadata.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: FAIL — `uploaded[0].title` is `"t"` (the mock's default), not `"Edited Title"`, because `confirmMetadata` isn't wired into `runPipeline` yet.

- [ ] **Step 3: Implement**

In `lib/pipeline.ts`, change the hooks type (currently lines 12-15):

```ts
export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
  confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>;
};
```

Then change the metadata/upload section (currently lines 76-84):

```ts
  hooks.onStep?.("Đang tạo tiêu đề/mô tả/tag cho YouTube...");
  const metadata = await deps.generateMetadata(car);
  hooks.onStep?.(`Metadata đã sinh xong: ${metadata.title}`);
  const finalMetadata = hooks.confirmMetadata ? await hooks.confirmMetadata(metadata) : metadata;

  hooks.onStep?.("Đang upload video lên YouTube...");
  const videoUrl = await deps.uploadToYoutube(videoPath, finalMetadata);
  await deps.unlink(videoPath);
  hooks.onStep?.(`Đã đăng: ${videoUrl}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.ts lib/pipeline.test.ts
git commit -m "feat: add optional confirmMetadata hook to pipeline core"
```

---

### Task 2: `.env` read/mask/write module

**Files:**
- Create: `lib/env-file.ts`
- Create: `lib/env-file.test.ts`
- Modify: `package.json` (test script glob)

**Interfaces:**
- Produces:
  - `KNOWN_ENV_KEYS: readonly string[]` — the 8 keys the dashboard manages: `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_PRIVACY_STATUS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
  - `type EnvKey = (typeof KNOWN_ENV_KEYS)[number]`
  - `parseEnvFile(content: string): Record<string, string>`
  - `maskValue(value: string): string`
  - `readEnvConfig(envPath: string): Promise<Record<EnvKey, { isSet: boolean; masked: string }>>`
  - `writeEnvConfig(envPath: string, updates: Partial<Record<EnvKey, string>>): Promise<Record<string, string>>` — returns the full merged key/value map (used by the caller to refresh `process.env`).
- Consumes: nothing from other new modules (pure, standalone).

- [ ] **Step 1: Write the failing tests**

Create `lib/env-file.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnvFile, maskValue, readEnvConfig, writeEnvConfig } from "./env-file.ts";

test("parseEnvFile ignores comments and blank lines", () => {
  const content = "# comment\nFOO=bar\n\nBAZ=qux\n";
  assert.deepEqual(parseEnvFile(content), { FOO: "bar", BAZ: "qux" });
});

test("maskValue masks long values keeping first/last 4 chars", () => {
  assert.equal(maskValue("AIzaSyABCDEFGHIJK"), "AIza****HIJK");
});

test("maskValue fully masks short values", () => {
  assert.equal(maskValue("abc"), "***");
  assert.equal(maskValue(""), "");
});

test("writeEnvConfig merges updates, readEnvConfig reflects them, blank keeps existing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yt-flow-env-"));
  const envPath = path.join(dir, ".env");
  try {
    await writeEnvConfig(envPath, { GEMINI_API_KEY: "secret-key-12345" });
    const config1 = await readEnvConfig(envPath);
    assert.equal(config1.GEMINI_API_KEY.isSet, true);
    assert.equal(config1.YOUTUBE_CLIENT_ID.isSet, false);

    await writeEnvConfig(envPath, { GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "client-abc" });
    const config2 = await readEnvConfig(envPath);
    assert.equal(config2.GEMINI_API_KEY.isSet, true);
    assert.equal(config2.GEMINI_API_KEY.masked, config1.GEMINI_API_KEY.masked);
    assert.equal(config2.YOUTUBE_CLIENT_ID.isSet, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readEnvConfig on missing file returns all keys unset", async () => {
  const config = await readEnvConfig("/tmp/yt-flow-does-not-exist/.env");
  assert.equal(config.GEMINI_API_KEY.isSet, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/env-file.test.ts`
Expected: FAIL — `lib/env-file.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Implement**

Create `lib/env-file.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";

export const KNOWN_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_PRIVACY_STATUS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;

export type EnvKey = (typeof KNOWN_ENV_KEYS)[number];

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function readExisting(envPath: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(envPath, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function readEnvConfig(
  envPath: string,
): Promise<Record<EnvKey, { isSet: boolean; masked: string }>> {
  const parsed = await readExisting(envPath);
  const result = {} as Record<EnvKey, { isSet: boolean; masked: string }>;
  for (const key of KNOWN_ENV_KEYS) {
    const value = parsed[key] ?? "";
    result[key] = { isSet: value !== "", masked: maskValue(value) };
  }
  return result;
}

export async function writeEnvConfig(
  envPath: string,
  updates: Partial<Record<EnvKey, string>>,
): Promise<Record<string, string>> {
  const merged = { ...(await readExisting(envPath)) };
  for (const key of KNOWN_ENV_KEYS) {
    const update = updates[key];
    if (update !== undefined && update !== "") merged[key] = update;
  }

  // ponytail: rewrites .env as plain KEY=VALUE lines; comments and blank-line
  // formatting in the original file are not preserved. Acceptable for a
  // local single-user config file — revisit if hand-written comments in
  // .env turn out to matter.
  const lines = Object.entries(merged).map(([key, value]) => `${key}=${value}`);
  await writeFile(envPath, lines.join("\n") + "\n");
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/env-file.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Widen the test script to cover all `lib/*.test.ts` files**

In `package.json`, change:

```json
"test": "tsx --test lib/pipeline.test.ts"
```

to:

```json
"test": "tsx --test lib/*.test.ts"
```

Run: `npm test`
Expected: PASS, and output shows both `pipeline.test.ts` and `env-file.test.ts` ran.

- [ ] **Step 6: Commit**

```bash
git add lib/env-file.ts lib/env-file.test.ts package.json
git commit -m "feat: add .env parse/mask/write module for the web dashboard"
```

---

### Task 3: job state machine wrapping `runPipeline`

**Files:**
- Create: `lib/test-support.ts` (shared mock deps, extracted from `lib/pipeline.test.ts`)
- Modify: `lib/pipeline.test.ts` (use the shared helper instead of its local one)
- Create: `lib/web-job.ts`
- Create: `lib/web-job.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `defaultDeps`, `type PipelineDeps` from `./pipeline.ts`; `type VideoMetadata` from `./generate-metadata.ts`.
- Produces:
  - `type JobState = { phase: "idle" } | { phase: "running"; car: string; step: string } | { phase: "awaiting-video"; car: string; videoPath: string } | { phase: "awaiting-metadata"; car: string; metadata: VideoMetadata } | { phase: "done"; car: string; youtubeUrl: string } | { phase: "error"; message: string }`
  - `type JobRunner = { getState(): JobState; subscribe(listener: (state: JobState) => void): () => void; start(carOverride?: string): boolean; decideVideo(approved: boolean): boolean; decideMetadata(metadata: VideoMetadata): boolean }`
  - `createJobRunner(deps?: PipelineDeps): JobRunner`

- [ ] **Step 1: Extract the shared mock deps (no behavior change yet)**

Create `lib/test-support.ts`:

```ts
import type { PipelineDeps } from "./pipeline.ts";

export type MockDeps = PipelineDeps & {
  calls: { generateVideo: number; unlink: number; uploadToYoutube: number; generateMetadata: number };
};

export function makeMockDeps(): MockDeps {
  const calls = { generateVideo: 0, unlink: 0, uploadToYoutube: 0, generateMetadata: 0 };
  return {
    calls,
    pickNextCar: async () => "Test Car",
    generateVideo: async () => {
      calls.generateVideo++;
      return `/tmp/video-${calls.generateVideo}.mp4`;
    },
    generateMetadata: async () => {
      calls.generateMetadata++;
      return { title: "t", description: "d", tags: [] };
    },
    uploadToYoutube: async () => {
      calls.uploadToYoutube++;
      return "https://youtu.be/test";
    },
    unlink: async () => {
      calls.unlink++;
    },
  };
}
```

In `lib/pipeline.test.ts`, replace the local `makeDeps` function and its `PipelineDeps` import with:

```ts
import { runPipeline } from "./pipeline.ts";
import { makeMockDeps } from "./test-support.ts";
import type { VideoMetadata } from "./generate-metadata.ts";
```

and replace every call site of `makeDeps()` in that file with `makeMockDeps()`. Delete the now-unused local `makeDeps` function definition entirely.

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: all 4 tests still PASS (pure refactor, no behavior change).

- [ ] **Step 2: Commit the refactor separately**

```bash
git add lib/test-support.ts lib/pipeline.test.ts
git commit -m "refactor: extract shared pipeline mock deps into lib/test-support.ts"
```

- [ ] **Step 3: Write the failing test for the job runner**

Create `lib/web-job.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobRunner, type JobRunner, type JobState } from "./web-job.ts";
import { makeMockDeps } from "./test-support.ts";

function waitForPhase(runner: JobRunner, phase: JobState["phase"]): Promise<JobState> {
  return new Promise((resolve) => {
    const unsubscribe = runner.subscribe((state) => {
      if (state.phase === phase) {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

test("start() goes idle -> running -> awaiting-video -> awaiting-metadata -> done", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  assert.equal(runner.getState().phase, "idle");

  assert.equal(runner.start(), true);
  const awaitingVideo = await waitForPhase(runner, "awaiting-video");
  assert.equal(awaitingVideo.phase, "awaiting-video");

  const awaitingMetadata = waitForPhase(runner, "awaiting-metadata");
  assert.equal(runner.decideVideo(true), true);
  await awaitingMetadata;

  const done = waitForPhase(runner, "done");
  assert.equal(runner.decideMetadata({ title: "Edited", description: "d", tags: [] }), true);
  const finalState = await done;
  assert.equal(finalState.phase, "done");
  assert.equal(deps.calls.uploadToYoutube, 1);
});

test("start() returns false while a job is already busy", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  runner.start();
  await waitForPhase(runner, "awaiting-video");
  assert.equal(runner.start(), false);
});

test("decideVideo(false) regenerates the video before reaching awaiting-metadata", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  runner.start();
  await waitForPhase(runner, "awaiting-video");

  const secondAwaitingVideo = waitForPhase(runner, "awaiting-video");
  assert.equal(runner.decideVideo(false), true);
  await secondAwaitingVideo;

  assert.equal(deps.calls.generateVideo, 2);
});

test("decideVideo/decideMetadata return false when nothing is pending", () => {
  const runner = createJobRunner(makeMockDeps());
  assert.equal(runner.decideVideo(true), false);
  assert.equal(runner.decideMetadata({ title: "", description: "", tags: [] }), false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx --test lib/web-job.test.ts`
Expected: FAIL — `lib/web-job.ts` doesn't exist yet.

- [ ] **Step 5: Implement**

Create `lib/web-job.ts`:

```ts
import { defaultDeps, runPipeline, type PipelineDeps } from "./pipeline.ts";
import type { VideoMetadata } from "./generate-metadata.ts";

export type JobState =
  | { phase: "idle" }
  | { phase: "running"; car: string; step: string }
  | { phase: "awaiting-video"; car: string; videoPath: string }
  | { phase: "awaiting-metadata"; car: string; metadata: VideoMetadata }
  | { phase: "done"; car: string; youtubeUrl: string }
  | { phase: "error"; message: string };

export type JobRunner = {
  getState: () => JobState;
  subscribe: (listener: (state: JobState) => void) => () => void;
  start: (carOverride?: string) => boolean;
  decideVideo: (approved: boolean) => boolean;
  decideMetadata: (metadata: VideoMetadata) => boolean;
};

export function createJobRunner(deps: PipelineDeps = defaultDeps): JobRunner {
  let state: JobState = { phase: "idle" };
  let currentCar = "";
  const listeners = new Set<(state: JobState) => void>();
  let pendingVideoResolve: ((approved: boolean) => void) | null = null;
  let pendingMetadataResolve: ((metadata: VideoMetadata) => void) | null = null;

  function setState(next: JobState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function isBusy(): boolean {
    return state.phase === "running" || state.phase === "awaiting-video" || state.phase === "awaiting-metadata";
  }

  function start(carOverride?: string): boolean {
    if (isBusy()) return false;

    currentCar = carOverride ?? "(đang chọn...)";
    setState({ phase: "running", car: currentCar, step: "Bắt đầu" });

    runPipeline(
      { carOverride },
      {
        onStep: (message) => {
          if (message.startsWith("Xe: ")) currentCar = message.slice("Xe: ".length);
          setState({ phase: "running", car: currentCar, step: message });
        },
        confirmVideo: (videoPath) =>
          new Promise<boolean>((resolve) => {
            pendingVideoResolve = resolve;
            setState({ phase: "awaiting-video", car: currentCar, videoPath });
          }),
        confirmMetadata: (metadata) =>
          new Promise<VideoMetadata>((resolve) => {
            pendingMetadataResolve = resolve;
            setState({ phase: "awaiting-metadata", car: currentCar, metadata });
          }),
      },
      deps,
    )
      .then((result) => {
        setState({ phase: "done", car: result.car, youtubeUrl: result.videoUrl });
      })
      .catch((err) => {
        setState({ phase: "error", message: (err as Error).message });
      })
      .finally(() => {
        pendingVideoResolve = null;
        pendingMetadataResolve = null;
      });

    return true;
  }

  function decideVideo(approved: boolean): boolean {
    if (!pendingVideoResolve) return false;
    pendingVideoResolve(approved);
    pendingVideoResolve = null;
    return true;
  }

  function decideMetadata(metadata: VideoMetadata): boolean {
    if (!pendingMetadataResolve) return false;
    pendingMetadataResolve(metadata);
    pendingMetadataResolve = null;
    return true;
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    decideVideo,
    decideMetadata,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test lib/web-job.test.ts`
Expected: all 4 tests PASS.

Run: `npm test`
Expected: all tests across `lib/*.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/web-job.ts lib/web-job.test.ts
git commit -m "feat: add in-memory job state machine wrapping runPipeline"
```

---

### Task 4: Express server (`scripts/web-server.ts`)

**Files:**
- Modify: `package.json` (add `express` dependency, `@types/express` devDependency, `web` script)
- Create: `scripts/web-server.ts`

**Interfaces:**
- Consumes: `createJobRunner`, `type JobState` from `../lib/web-job.ts`; `readEnvConfig`, `writeEnvConfig`, `KNOWN_ENV_KEYS`, `type EnvKey` from `../lib/env-file.ts`.
- Produces (HTTP surface consumed by `public/app.js` in Task 5):
  - `GET /api/config` → `Record<EnvKey, { isSet: boolean; masked: string }>`
  - `POST /api/config` (JSON body `Partial<Record<EnvKey, string>>`) → same shape as GET, or `400 { error }`
  - `GET /api/cars` → `{ pool: string[]; queue: string[] }`
  - `POST /api/generate` (JSON body `{ car?: string }`) → `202 JobState` or `409 JobState`
  - `POST /api/video-decision` (JSON body `{ approved: boolean }`) → `200 { ok: true }` or `409 { error }`
  - `POST /api/metadata-decision` (JSON body `{ title: string; description: string; tags: string[] }`) → `200 { ok: true }`, `400 { error }`, or `409 { error }`
  - `GET /api/events` → SSE stream of `JobState`, one `data: <json>\n\n` frame per state change, current state sent immediately on connect
  - Static: `/` serves `public/`, `/media/<file>` serves `output/`

- [ ] **Step 1: Add the `express` dependency**

Run:
```bash
npm install express
npm install --save-dev @types/express
```

- [ ] **Step 2: Add the `web` script**

In `package.json`, add to `"scripts"`:

```json
"web": "tsx --env-file=.env scripts/web-server.ts"
```

- [ ] **Step 3: Implement the server**

Create `scripts/web-server.ts`:

```ts
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
```

- [ ] **Step 4: Manual smoke test (read-only endpoints only — do not call `/api/generate` here)**

`/api/generate` drives the real Playwright/Gemini/YouTube pipeline and needs
a logged-in Gemini profile and real YouTube OAuth credentials — it's not
something to trigger during automated plan execution. Verify the wiring
with the safe, side-effect-free endpoints instead:

```bash
npm run web &
sleep 1
curl -s http://127.0.0.1:3000/api/cars
curl -s http://127.0.0.1:3000/api/config
curl -s -X POST http://127.0.0.1:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"GEMINI_TEXT_MODEL":"gemini-2.5-flash"}'
curl -s -N http://127.0.0.1:3000/api/events & sleep 1; kill %2
kill %1
```

Expected:
- `/api/cars` → JSON with `pool` (20 cars) and `queue` arrays.
- `/api/config` → JSON with all 8 keys, each `{ isSet, masked }`.
- `POST /api/config` → echoes back updated config JSON, no error.
- `/api/events` → prints one `data: {"phase":"idle"}` line, then hangs (SSE) until killed.

Full end-to-end (`/api/generate` → video preview → approve → metadata edit →
upload) is manual QA for the user after this plan lands, same as how
`scripts/telegram-bot.ts` is tested against the real bot.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/web-server.ts
git commit -m "feat: add Express web server wiring job runner to HTTP/SSE"
```

---

### Task 5: Frontend (`public/`)

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: the HTTP/SSE surface from Task 4 (`/api/config`, `/api/cars`, `/api/generate`, `/api/video-decision`, `/api/metadata-decision`, `/api/events`, `/media/<file>`).
- Produces: nothing consumed by other tasks (leaf/UI layer).

- [ ] **Step 1: Create the page structure**

Create `public/index.html`:

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>yt-flow dashboard</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <h1>yt-flow dashboard</h1>

  <section id="setup">
    <h2>Setup</h2>
    <form id="config-form"></form>
    <p id="config-status"></p>
  </section>

  <section id="cars">
    <h2>Xe</h2>
    <strong>Queue hiện tại:</strong>
    <ul id="queue-list"></ul>
    <label>
      Chọn xe cụ thể (tuỳ chọn)
      <select id="car-select"><option value="">-- dùng queue mặc định --</option></select>
    </label>
    <button id="generate-btn" type="button">Generate</button>
    <p id="generate-status"></p>
  </section>

  <section id="progress" hidden>
    <h2>Đang chạy</h2>
    <p id="progress-car"></p>
    <p id="progress-step"></p>
  </section>

  <section id="video-review" hidden>
    <h2>Preview video</h2>
    <video id="video-player" controls></video>
    <div>
      <button id="approve-video-btn" type="button">Duyệt</button>
      <button id="reject-video-btn" type="button">Từ chối</button>
    </div>
  </section>

  <section id="metadata-review" hidden>
    <h2>Metadata</h2>
    <label>Title <input id="meta-title" type="text" /></label>
    <label>Description <textarea id="meta-description"></textarea></label>
    <label>Tags (phân cách bằng dấu phẩy) <input id="meta-tags" type="text" /></label>
    <button id="upload-btn" type="button">Upload</button>
  </section>

  <section id="result" hidden>
    <h2>Kết quả</h2>
    <p id="result-message"></p>
    <button id="reset-btn" type="button">Generate tiếp</button>
  </section>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement the client logic**

Create `public/app.js`:

```js
const configForm = document.getElementById("config-form");
const configStatus = document.getElementById("config-status");
const queueList = document.getElementById("queue-list");
const carSelect = document.getElementById("car-select");
const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");

const sections = {
  progress: document.getElementById("progress"),
  videoReview: document.getElementById("video-review"),
  metadataReview: document.getElementById("metadata-review"),
  result: document.getElementById("result"),
};

function hidePhaseSections() {
  for (const el of Object.values(sections)) el.hidden = true;
}

async function loadConfig() {
  const config = await fetch("/api/config").then((r) => r.json());
  configForm.innerHTML = "";
  for (const [key, info] of Object.entries(config)) {
    const label = document.createElement("label");
    label.textContent = info.isSet ? `${key} (${info.masked})` : key;
    const input = document.createElement("input");
    input.type = "text";
    input.name = key;
    input.placeholder = info.isSet ? "Để trống để giữ nguyên" : "";
    label.appendChild(input);
    configForm.appendChild(label);
  }
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.textContent = "Lưu";
  configForm.appendChild(saveBtn);
}

configForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  for (const input of configForm.querySelectorAll("input")) {
    if (input.value) body[input.name] = input.value;
  }
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    configStatus.textContent = "Đã lưu.";
    await loadConfig();
  } else {
    const err = await res.json();
    configStatus.textContent = `Lỗi: ${err.error}`;
  }
});

async function loadCars() {
  const { pool, queue } = await fetch("/api/cars").then((r) => r.json());
  queueList.innerHTML = "";
  for (const car of queue) {
    const li = document.createElement("li");
    li.textContent = car;
    queueList.appendChild(li);
  }
  carSelect.innerHTML = '<option value="">-- dùng queue mặc định --</option>';
  for (const car of pool) {
    const option = document.createElement("option");
    option.value = car;
    option.textContent = car;
    carSelect.appendChild(option);
  }
}

generateBtn.addEventListener("click", async () => {
  const car = carSelect.value || undefined;
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ car }),
  });
  generateStatus.textContent = res.status === 409 ? "Đang bận, đợi job hiện tại xong." : "";
});

document.getElementById("approve-video-btn").addEventListener("click", () => {
  fetch("/api/video-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: true }),
  });
});

document.getElementById("reject-video-btn").addEventListener("click", () => {
  fetch("/api/video-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: false }),
  });
});

document.getElementById("upload-btn").addEventListener("click", () => {
  const title = document.getElementById("meta-title").value;
  const description = document.getElementById("meta-description").value;
  const tags = document
    .getElementById("meta-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  fetch("/api/metadata-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, tags }),
  });
});

document.getElementById("reset-btn").addEventListener("click", () => {
  hidePhaseSections();
  loadCars();
});

function renderState(state) {
  hidePhaseSections();

  if (state.phase === "running") {
    sections.progress.hidden = false;
    document.getElementById("progress-car").textContent = `Xe: ${state.car}`;
    document.getElementById("progress-step").textContent = state.step;
  } else if (state.phase === "awaiting-video") {
    sections.videoReview.hidden = false;
    const filename = state.videoPath.split("/").pop();
    document.getElementById("video-player").src = `/media/${filename}`;
  } else if (state.phase === "awaiting-metadata") {
    sections.metadataReview.hidden = false;
    document.getElementById("meta-title").value = state.metadata.title;
    document.getElementById("meta-description").value = state.metadata.description;
    document.getElementById("meta-tags").value = state.metadata.tags.join(", ");
  } else if (state.phase === "done") {
    sections.result.hidden = false;
    document.getElementById("result-message").innerHTML =
      `Đã đăng: <a href="${state.youtubeUrl}" target="_blank" rel="noopener">${state.youtubeUrl}</a>`;
  } else if (state.phase === "error") {
    sections.result.hidden = false;
    document.getElementById("result-message").textContent = `Lỗi: ${state.message}`;
  }
}

new EventSource("/api/events").onmessage = (e) => renderState(JSON.parse(e.data));

loadConfig();
loadCars();
```

- [ ] **Step 3: Style**

Create `public/style.css`:

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
}

section {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #ddd;
}

label {
  display: block;
  margin-bottom: 0.5rem;
}

input,
textarea,
select {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  box-sizing: border-box;
}

video {
  width: 100%;
  max-width: 400px;
}

button {
  margin-top: 0.5rem;
  margin-right: 0.5rem;
}
```

- [ ] **Step 4: Manual verification**

```bash
npm run web &
sleep 1
curl -s http://127.0.0.1:3000/ | grep -o '<title>.*</title>'
curl -s http://127.0.0.1:3000/app.js | head -1
kill %1
```

Expected: title tag prints `<title>yt-flow dashboard</title>`, `app.js` serves without a 404.

Then, separately (real browser, done by the user — not part of automated
execution): open `http://127.0.0.1:3000`, confirm the Setup form renders 8
fields, the Cars section lists the queue and populates the dropdown, and
clicking through a real Generate run shows progress → video preview →
approve/reject → metadata edit → result, matching the design spec's flow.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add vanilla-JS dashboard frontend"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`
- Modify: `README.vi.md`
- Modify: `.env.example`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add `WEB_PORT` to `.env.example`**

In `.env.example`, after the `TELEGRAM_CHAT_ID` line, add:

```
# Web dashboard (scripts/web-server.ts) — port to bind on localhost, default 3000
# WEB_PORT=3000
```

- [ ] **Step 2: Document the dashboard in `README.md`**

Insert a new `## Web dashboard` section after the existing `## Remote control via Telegram` section (before `## If Google changes the Gemini UI`):

```markdown
## Web dashboard

`npm run web` starts a local dashboard at `http://127.0.0.1:3000` (override
the port with `WEB_PORT`) for setting up keys, picking a car, generating,
previewing, and approving in the browser instead of the terminal or
Telegram.

1. `npm run web`.
2. Open `http://127.0.0.1:3000`.
3. Fill in the keys in the Setup section and save (existing values show
   masked; leave a field blank to keep it unchanged).
4. Pick a car from the dropdown (optional — leave blank to use the normal
   queue order) and click **Generate**.
5. Once the video is ready, preview it inline and click **Duyệt** (approve)
   or **Từ chối** (reject and regenerate).
6. Edit the generated title/description/tags if needed, then click
   **Upload** to publish to YouTube.

The dashboard binds to `127.0.0.1` only and has no login — it's meant for
local, single-user use. Run only one of the web dashboard, `npm run bot`,
or `npm run pipeline` at a time; running more than one against the same
`data/cars-queue.json` at once can race.
```

- [ ] **Step 3: Mirror the section in `README.vi.md`**

Insert after `## Điều khiển từ xa qua Telegram` (before `## Nếu Google đổi giao diện Gemini`):

```markdown
## Giao diện web

`npm run web` chạy 1 dashboard local tại `http://127.0.0.1:3000` (đổi port
bằng `WEB_PORT`) để setup key, chọn xe, generate, preview và duyệt ngay
trên trình duyệt thay vì terminal hoặc Telegram.

1. `npm run web`.
2. Mở `http://127.0.0.1:3000`.
3. Điền key ở phần Setup rồi lưu (giá trị cũ hiện dạng che bớt; để trống
   ô nào nghĩa là giữ nguyên giá trị đó).
4. Chọn 1 xe cụ thể từ dropdown (tuỳ chọn — để trống dùng thứ tự queue
   mặc định) rồi bấm **Generate**.
5. Video sinh xong, preview ngay trên trang, bấm **Duyệt** hoặc
   **Từ chối** (tạo lại).
6. Sửa title/description/tags nếu cần, bấm **Upload** để đăng lên
   YouTube.

Dashboard chỉ bind `127.0.0.1`, không có đăng nhập — chỉ dành cho dùng
local 1 người. Chỉ nên chạy 1 trong 3 cách (web dashboard / `npm run bot`
/ `npm run pipeline`) tại 1 thời điểm — chạy nhiều cái cùng lúc có thể
tranh nhau `data/cars-queue.json`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md README.vi.md .env.example
git commit -m "docs: document the web dashboard"
```
