# Telegram Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user trigger, preview/approve, and monitor the car-video-to-YouTube pipeline entirely from Telegram, with no terminal interaction required.

**Architecture:** Extract the existing pipeline logic (`scripts/run-shorts-pipeline.ts`) into a reusable core `lib/pipeline.ts` that takes preview/confirm behavior as injected callbacks. Two thin drivers consume it: the existing CLI script (readline-based confirm, unchanged behavior) and a new `scripts/telegram-bot.ts` long-polling bot (inline-keyboard-based confirm, plus `/run`, `/status`, `/approve`, `/reject` commands).

**Tech Stack:** TypeScript + `tsx` (existing), `grammy` (new — Telegram bot framework), Node's built-in `node:test` + `node:assert/strict` for unit tests (no new test framework dependency).

## Global Constraints

- Keep `npm run pipeline` (CLI flow) behavior unchanged for the end user — same prompts, same y/n confirm, same file-open preview.
- Only one pipeline run at a time. A second `/run` while busy is rejected with a status message — no queueing (per spec, out of scope).
- Telegram bot only responds to `chat.id === TELEGRAM_CHAT_ID`; every other chat is silently ignored (no reply at all).
- Must run unmodified on both macOS and Windows (spec requirement) — no OS-specific code beyond the existing `darwin`/`win32`/other branching already in the preview-open helper.
- No new test framework or mocking library dependency — use Node's built-in `node:test` runner (already available, Node v24) via `tsx --test`.
- No automated tests for the Telegram wiring itself (`scripts/telegram-bot.ts`) — spec explicitly scopes that to manual verification.
- `carOverride` must be validated against `data/cars.json` (the full pool) before any video generation starts; invalid input throws immediately with a clear Vietnamese error message.

---

## File Structure

- Create: `lib/pipeline.ts` — pure pipeline core, dependency-injectable, no Telegram/readline/console dependency.
- Create: `lib/pipeline.test.ts` — unit tests for the core, using injected fake deps.
- Modify: `scripts/run-shorts-pipeline.ts` — becomes a thin driver: readline confirm + preview-open, calls `runPipeline`.
- Create: `scripts/telegram-bot.ts` — long-polling bot driver: inline-keyboard confirm, `/run`, `/status`, `/approve`, `/reject`.
- Modify: `.env.example` — add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Modify: `package.json` — add `grammy` dependency, `bot` script, `test` script.
- Modify: `README.md`, `README.vi.md` — document bot setup and `pm2` background-running.

---

### Task 1: Extract pipeline core into `lib/pipeline.ts` with tests

**Files:**
- Create: `lib/pipeline.ts`
- Create: `lib/pipeline.test.ts`
- Test: `lib/pipeline.test.ts` (same file — see step 1)

**Interfaces:**
- Consumes: `pickNextCar(): Promise<string>` from `lib/car-picker.ts`; `generateMetadata(carModel: string): Promise<VideoMetadata>` and `interface VideoMetadata { title: string; description: string; tags: string[] }` from `lib/generate-metadata.ts`; `generateVideo(prompt: string): Promise<string>` and `uploadToYoutube(filePath: string, meta: YoutubeMeta): Promise<string>` from `scripts/veo-to-youtube.ts` (note: `YoutubeMeta` there has the same shape as `VideoMetadata`).
- Produces (for Task 2 and Task 4):
  ```ts
  export type PipelineHooks = {
    onStep?: (message: string) => void;
    confirmVideo: (videoPath: string) => Promise<boolean>;
  };
  export type PipelineOptions = { carOverride?: string };
  export type PipelineResult = { car: string; videoUrl: string };
  export type PipelineDeps = {
    pickNextCar: () => Promise<string>;
    generateVideo: (prompt: string) => Promise<string>;
    generateMetadata: (car: string) => Promise<VideoMetadata>;
    uploadToYoutube: (videoPath: string, meta: VideoMetadata) => Promise<string>;
    unlink: (path: string) => Promise<void>;
  };
  export const defaultDeps: PipelineDeps;
  export async function runPipeline(
    options: PipelineOptions,
    hooks: PipelineHooks,
    deps?: PipelineDeps,
  ): Promise<PipelineResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/pipeline.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline, type PipelineDeps } from "./pipeline.ts";

function makeDeps(): PipelineDeps & {
  calls: { generateVideo: number; unlink: number; uploadToYoutube: number; generateMetadata: number };
} {
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

test("confirmVideo false triggers regeneration, true continues to upload", async () => {
  const deps = makeDeps();
  let confirmCalls = 0;
  const confirmVideo = async () => {
    confirmCalls++;
    return confirmCalls >= 2;
  };

  const result = await runPipeline({}, { confirmVideo }, deps);

  assert.equal(deps.calls.generateVideo, 2);
  assert.equal(deps.calls.unlink, 2);
  assert.equal(deps.calls.uploadToYoutube, 1);
  assert.equal(deps.calls.generateMetadata, 1);
  assert.equal(result.videoUrl, "https://youtu.be/test");
  assert.equal(result.car, "Test Car");
});

test("confirmVideo true immediately uploads on first try", async () => {
  const deps = makeDeps();
  const result = await runPipeline({}, { confirmVideo: async () => true }, deps);

  assert.equal(deps.calls.generateVideo, 1);
  assert.equal(deps.calls.unlink, 1);
  assert.equal(deps.calls.uploadToYoutube, 1);
  assert.equal(result.car, "Test Car");
});

test("invalid carOverride throws before generating any video", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () => runPipeline({ carOverride: "Không Tồn Tại XYZ" }, { confirmVideo: async () => true }, deps),
    /Không tìm thấy xe/,
  );
  assert.equal(deps.calls.generateVideo, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: FAIL — `lib/pipeline.ts` does not exist (module not found).

- [ ] **Step 3: Write `lib/pipeline.ts`**

```ts
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickNextCar } from "./car-picker.ts";
import { generateMetadata, type VideoMetadata } from "./generate-metadata.ts";
import { generateVideo, uploadToYoutube } from "../scripts/veo-to-youtube.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const veoTemplatePath = path.join(projectRoot, "prompt-veo3.md");
const carsPoolPath = path.join(projectRoot, "data", "cars.json");

export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
};

export type PipelineOptions = {
  carOverride?: string;
};

export type PipelineResult = {
  car: string;
  videoUrl: string;
};

export type PipelineDeps = {
  pickNextCar: () => Promise<string>;
  generateVideo: (prompt: string) => Promise<string>;
  generateMetadata: (car: string) => Promise<VideoMetadata>;
  uploadToYoutube: (videoPath: string, meta: VideoMetadata) => Promise<string>;
  unlink: (path: string) => Promise<void>;
};

export const defaultDeps: PipelineDeps = {
  pickNextCar,
  generateVideo,
  generateMetadata,
  uploadToYoutube,
  unlink,
};

async function resolveCar(carOverride: string | undefined, deps: PipelineDeps): Promise<string> {
  if (!carOverride) return deps.pickNextCar();

  const pool = JSON.parse(await readFile(carsPoolPath, "utf-8")) as string[];
  const match = pool.find((c) => c.toLowerCase() === carOverride.toLowerCase());
  if (!match) {
    throw new Error(`Không tìm thấy xe "${carOverride}" trong data/cars.json`);
  }
  return match;
}

export async function runPipeline(
  options: PipelineOptions,
  hooks: PipelineHooks,
  deps: PipelineDeps = defaultDeps,
): Promise<PipelineResult> {
  const car = await resolveCar(options.carOverride, deps);
  hooks.onStep?.(`Xe: ${car}`);

  const veoTemplate = await readFile(veoTemplatePath, "utf-8");
  const veoPrompt = veoTemplate.replaceAll("{CAR_MODEL}", car);

  let videoPath: string;
  while (true) {
    videoPath = await deps.generateVideo(veoPrompt);
    hooks.onStep?.(`Video đã sinh xong: ${videoPath}`);

    const approved = await hooks.confirmVideo(videoPath);
    if (approved) break;

    hooks.onStep?.("Bị từ chối, sinh lại video...");
    await deps.unlink(videoPath);
  }

  const metadata = await deps.generateMetadata(car);
  hooks.onStep?.(`Metadata đã sinh xong: ${metadata.title}`);

  const videoUrl = await deps.uploadToYoutube(videoPath, metadata);
  await deps.unlink(videoPath);
  hooks.onStep?.(`Đã đăng: ${videoUrl}`);

  return { car, videoUrl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: PASS, 3 tests, 0 failures.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline.ts lib/pipeline.test.ts
git commit -m "feat: extract pipeline core into lib/pipeline.ts with injectable deps"
```

---

### Task 2: Refactor `scripts/run-shorts-pipeline.ts` to use `lib/pipeline.ts`

**Files:**
- Modify: `scripts/run-shorts-pipeline.ts` (full rewrite of the file's content, same file path)

**Interfaces:**
- Consumes: `runPipeline`, `PipelineHooks` from `lib/pipeline.ts` (Task 1).
- Produces: nothing new — this is a leaf driver.

- [ ] **Step 1: Rewrite `scripts/run-shorts-pipeline.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import { runPipeline } from "../lib/pipeline.ts";

const execFileAsync = promisify(execFile);

async function previewVideo(videoPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [videoPath]);
  } else if (process.platform === "win32") {
    // empty "" is the `start` window-title arg, required so a path with spaces isn't misread as the title
    await execFileAsync("cmd", ["/c", "start", "", videoPath]);
  } else {
    await execFileAsync("xdg-open", [videoPath]);
  }
}

async function confirmVideo(videoPath: string): Promise<boolean> {
  await previewVideo(videoPath);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Video ok? (y = tiếp tục upload, n = tạo lại): ");
    return /^y/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const result = await runPipeline({}, { onStep: (message) => console.log(message), confirmVideo });
  console.log(`Published: ${result.videoUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing unit tests to confirm nothing broke**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: PASS, 3 tests, 0 failures (this task didn't touch `lib/pipeline.ts`, this is a regression check).

- [ ] **Step 4: Manual smoke check (optional, costs real API calls — skip if not desired right now)**

Run: `npm run pipeline`, confirm it still: prints `Car: <name>`, opens the video file, asks the `y`/`n` prompt, and on `y` prints `Published: <url>`.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-shorts-pipeline.ts
git commit -m "refactor: run-shorts-pipeline.ts now drives the shared lib/pipeline.ts core"
```

---

### Task 3: Add `grammy` dependency, Telegram env vars, and npm scripts

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `grammy` importable from `scripts/telegram-bot.ts` (Task 4); `npm test` runs `lib/pipeline.test.ts`; `npm run bot` runs `scripts/telegram-bot.ts`; `process.env.TELEGRAM_BOT_TOKEN` / `process.env.TELEGRAM_CHAT_ID` available at runtime.

- [ ] **Step 1: Install `grammy`**

Run: `npm install grammy`
Expected: `package.json` `dependencies` gains `"grammy": "^<version>"`, `package-lock.json` updates.

- [ ] **Step 2: Add `bot` and `test` scripts to `package.json`**

Edit the `"scripts"` block in `package.json` to:

```json
"scripts": {
  "pipeline": "tsx --env-file=.env scripts/run-shorts-pipeline.ts",
  "gemini:login": "tsx --env-file=.env scripts/gemini-login.ts",
  "bot": "tsx --env-file=.env scripts/telegram-bot.ts",
  "test": "tsx --test lib/pipeline.test.ts"
}
```

- [ ] **Step 3: Add Telegram env vars to `.env.example`**

Append to `.env.example`:

```
# Telegram bot (scripts/telegram-bot.ts) — control the pipeline remotely
TELEGRAM_BOT_TOKEN=
# chat/user id allowed to issue commands — everyone else is silently ignored
TELEGRAM_CHAT_ID=
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS, 3 tests (this confirms the new `test` script wiring works).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add grammy dependency, bot/test npm scripts, Telegram env vars"
```

---

### Task 4: Implement `scripts/telegram-bot.ts`

**Files:**
- Create: `scripts/telegram-bot.ts`

**Interfaces:**
- Consumes: `runPipeline`, `PipelineHooks`, `PipelineOptions` from `lib/pipeline.ts` (Task 1); `Bot`, `InlineKeyboard`, `InputFile` from `grammy` (Task 3); `process.env.TELEGRAM_BOT_TOKEN`, `process.env.TELEGRAM_CHAT_ID` (Task 3).
- Produces: nothing consumed elsewhere — this is the top-level entry point started by `npm run bot`.

- [ ] **Step 1: Write `scripts/telegram-bot.ts`**

```ts
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { runPipeline } from "../lib/pipeline.ts";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = Number(process.env.TELEGRAM_CHAT_ID);
if (!token) throw new Error("Thiếu TELEGRAM_BOT_TOKEN trong .env");
if (!chatId) throw new Error("Thiếu hoặc sai TELEGRAM_CHAT_ID trong .env");

const bot = new Bot(token);

let busy = false;
let currentCar: string | null = null;
let currentStep: string | null = null;
let pendingConfirm: ((approved: boolean) => void) | null = null;

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== chatId) return;
  await next();
});

bot.command("status", async (ctx) => {
  if (!busy) {
    await ctx.reply("Rảnh.");
    return;
  }
  await ctx.reply(`Đang chạy xe ${currentCar}, bước: ${currentStep}.`);
});

bot.command("run", async (ctx) => {
  if (busy) {
    await ctx.reply(`Đang chạy xe ${currentCar}, bước: ${currentStep}. Đợi xong đã.`);
    return;
  }

  const carOverride = ctx.match?.toString().trim() || undefined;
  busy = true;
  currentCar = carOverride ?? "(đang chọn...)";
  currentStep = "Bắt đầu";

  runPipeline(
    { carOverride },
    {
      onStep: (message) => {
        currentStep = message;
        if (message.startsWith("Xe: ")) currentCar = message.slice("Xe: ".length);
        ctx.reply(message).catch(() => {});
      },
      confirmVideo: (videoPath) =>
        new Promise<boolean>((resolve) => {
          pendingConfirm = resolve;
          const keyboard = new InlineKeyboard().text("Duyệt", "approve").text("Làm lại", "reject");
          ctx
            .replyWithVideo(new InputFile(videoPath), { reply_markup: keyboard })
            .catch(async (err) => {
              await ctx.reply(
                `Video quá lớn để gửi qua Telegram, xem trực tiếp tại ${videoPath} trên máy. ` +
                  `Gõ /approve hoặc /reject để tiếp tục. (Lỗi: ${(err as Error).message})`,
              );
            });
        }),
    },
  )
    .then(async (result) => {
      await ctx.reply(`Đã đăng: ${result.videoUrl}`);
    })
    .catch(async (err) => {
      await ctx.reply(`Lỗi: ${(err as Error).message}`);
    })
    .finally(() => {
      busy = false;
      currentCar = null;
      currentStep = null;
      pendingConfirm = null;
    });
});

bot.command("approve", async (ctx) => {
  if (!pendingConfirm) return;
  pendingConfirm(true);
  pendingConfirm = null;
});

bot.command("reject", async (ctx) => {
  if (!pendingConfirm) return;
  pendingConfirm(false);
  pendingConfirm = null;
});

bot.on("callback_query:data", async (ctx) => {
  const approved = ctx.callbackQuery.data === "approve";
  await ctx.answerCallbackQuery();
  pendingConfirm?.(approved);
  pendingConfirm = null;
});

bot.start();
console.log("Telegram bot đang chạy, chờ lệnh /run...");
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification against the real Telegram API**

Prereqs: `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather), `TELEGRAM_CHAT_ID` from messaging the bot once and checking `https://api.telegram.org/bot<token>/getUpdates`, both set in `.env`.

Run: `npm run bot`, then from the authorized Telegram chat:
- Send `/status` → expect "Rảnh."
- Send `/run` → expect a "Xe: ..." message, then (after video generation completes) a video message with **Duyệt**/**Làm lại** buttons.
- Send `/status` again while busy → expect "Đang chạy xe ..., bước ...".
- From a *different* Telegram account, send `/status` → expect no reply at all.
- Tap **Làm lại** → expect "Bị từ chối, sinh lại video..." then a new video + buttons.
- Tap **Duyệt** → expect metadata + "Đã đăng: https://youtu.be/..." message.
- Send `/run` again while the above is still in flight (if timing allows) → expect the busy message, not a second run.

- [ ] **Step 4: Commit**

```bash
git add scripts/telegram-bot.ts
git commit -m "feat: add Telegram bot driver for remote pipeline control"
```

---

### Task 5: Document the Telegram bot in README

**Files:**
- Modify: `README.md`
- Modify: `README.vi.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing.

- [ ] **Step 1: Add a "Remote control via Telegram" section to `README.md`**, after the existing "## Running" section:

```markdown
## Remote control via Telegram

`npm run bot` starts a long-running bot that lets you trigger and approve
runs from your phone — no terminal needed after it's started.

1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token
   into `TELEGRAM_BOT_TOKEN` in `.env`.
2. Send any message to your new bot, then open
   `https://api.telegram.org/bot<token>/getUpdates` in a browser and copy
   `message.chat.id` into `TELEGRAM_CHAT_ID` in `.env`. Only this chat can
   issue commands — everyone else is silently ignored.
3. `npm run bot`.
4. From Telegram:
   - `/run` — pick the next car from the queue and run the full pipeline.
   - `/run Toyota Supra MK4` — run the pipeline for a specific car (must
     match an entry in `data/cars.json`).
   - `/status` — check whether a run is in progress and which step it's on.
   - When a video is generated you'll receive it with **Duyệt** (approve)
     / **Làm lại** (regenerate) buttons. If the video is too large for
     Telegram to send (>50MB), open the printed path on the machine
     directly and reply `/approve` or `/reject` instead.

Keep it running in the background with [pm2](https://pm2.keymetrics.io/)
(works the same on macOS and Windows):

```bash
npm install -g pm2
pm2 start npm --name yt-flow-bot -- run bot
pm2 save
```
```

- [ ] **Step 2: Add the matching Vietnamese section to `README.vi.md`**, after the existing "## Chạy" section:

```markdown
## Điều khiển từ xa qua Telegram

`npm run bot` chạy 1 bot nền, cho phép kích hoạt và duyệt video ngay từ
điện thoại — không cần đụng terminal sau khi đã khởi động bot.

1. Tạo bot qua [@BotFather](https://t.me/BotFather), copy token vào
   `TELEGRAM_BOT_TOKEN` trong `.env`.
2. Gửi 1 tin nhắn bất kỳ cho bot, sau đó mở
   `https://api.telegram.org/bot<token>/getUpdates` trên trình duyệt, copy
   `message.chat.id` vào `TELEGRAM_CHAT_ID` trong `.env`. Chỉ chat này được
   ra lệnh — chat khác bị bỏ qua hoàn toàn (không phản hồi).
3. `npm run bot`.
4. Từ Telegram:
   - `/run` — lấy xe tiếp theo trong queue, chạy toàn bộ pipeline.
   - `/run Toyota Supra MK4` — chạy pipeline cho 1 xe cụ thể (phải khớp 1
     dòng trong `data/cars.json`).
   - `/status` — xem có đang chạy không, đang ở bước nào.
   - Khi video sinh xong, bạn nhận được video kèm nút **Duyệt** / **Làm
     lại**. Nếu video quá lớn để gửi qua Telegram (>50MB), mở trực tiếp
     đường dẫn được in ra trên máy rồi gõ `/approve` hoặc `/reject`.

Giữ bot chạy nền bằng [pm2](https://pm2.keymetrics.io/) (chạy giống nhau
trên macOS và Windows):

```bash
npm install -g pm2
pm2 start npm --name yt-flow-bot -- run bot
pm2 save
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.vi.md
git commit -m "docs: document Telegram bot setup and pm2 background running"
```
