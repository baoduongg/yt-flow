# Playwright Gemini Video Gen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Veo3-API-based `generateVideo()` with a Playwright driver that generates video through the logged-in `gemini.google.com` web app, so the pipeline works without a Veo3 API key.

**Architecture:** New `lib/gemini-browser.ts` module owns a Playwright persistent browser context (session lives in `.gemini-profile/` on disk) and exposes `loginGemini()` (one-time interactive setup) and `generateVideoViaBrowser(prompt)` (drives the UI, returns a downloaded mp4 path). `scripts/veo-to-youtube.ts`'s `generateVideo()` becomes a thin wrapper around it. `lib/generate-metadata.ts` and the YouTube upload path are untouched.

**Tech Stack:** Playwright (chromium), TypeScript, tsx, existing `googleapis` YouTube upload.

## Global Constraints

- Always launch the browser `headless: false` — headless Chromium is more likely to get flagged as a bot by Google. (spec: Architecture)
- Persistent profile dir defaults to `.gemini-profile/` at project root, overridable via `GEMINI_PROFILE_DIR` env var. (spec: Architecture)
- `generateVideoViaBrowser(prompt: string): Promise<string>` must match the exact contract of the current `generateVideo()` — returns a local file path to a downloaded mp4. (spec: Architecture)
- Video-ready polling: 10s interval, 10 minute total timeout, then throw. (spec: Flow step 5)
- No automated tests for the browser-driving code — it drives a live third-party UI with a real Google account, which can't be meaningfully unit-tested or run in CI. Verification is manual, run in headed mode. (spec: Testing)
- Selectors for Google's UI are guessed (role/text-based Playwright locators) since the live DOM isn't inspectable ahead of time. Mark each guessed selector with a `ponytail:` comment pointing back to the spec doc. (spec: Known risk)
- Not adding retry/backoff or an API/browser strategy abstraction — fail loud, let the user re-run. (spec: Not doing)

---

### Task 1: Init git repo + .gitignore

**Files:**
- Create: `.gitignore`

**Interfaces:**
- None (no code yet).

- [ ] **Step 1: Init git**

Run: `git init` (in `/Users/dungnb/Desktop/yt-flow`)

- [ ] **Step 2: Write .gitignore**

```
node_modules/
.env
.gemini-profile/
output/
```

- [ ] **Step 3: Verify secrets are excluded before staging anything**

Run: `git status`
Expected: `.env` does NOT appear in the untracked/staged list. If it does, the `.gitignore` wasn't picked up — stop and fix before continuing.

- [ ] **Step 4: Stage and commit everything else**

```bash
git add .
git status
```

Check the staged file list one more time for anything unexpected (no `.env`, no `node_modules/`), then:

```bash
git commit -m "chore: init git repo"
```

---

### Task 2: Add Playwright dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `playwright` package importable as `import { chromium } from "playwright"` in later tasks.

- [ ] **Step 1: Add dependency and a login script entry**

Edit `package.json`:

```json
{
  "name": "yt-flow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "pipeline": "tsx --env-file=.env scripts/run-shorts-pipeline.ts",
    "gemini:login": "tsx --env-file=.env scripts/gemini-login.ts"
  },
  "dependencies": {
    "@google/genai": "^1.11.0",
    "googleapis": "^144.0.0",
    "playwright": "^1.48.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: exits 0, `playwright` present in `node_modules/`.

- [ ] **Step 3: Install the chromium browser binary**

Run: `npx playwright install chromium`
Expected: downloads and installs without error.

- [ ] **Step 4: Verify**

Run: `npx playwright --version`
Expected: prints a version string (no "command not found").

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add playwright dependency"
```

---

### Task 3: Persistent browser context + interactive login

**Files:**
- Create: `lib/gemini-browser.ts`
- Create: `scripts/gemini-login.ts`

**Interfaces:**
- Consumes: `chromium` from `playwright`.
- Produces:
  - `export async function loginGemini(): Promise<void>` — used by `scripts/gemini-login.ts` (this task) and referenced in setup docs.
  - `export async function generateVideoViaBrowser(prompt: string): Promise<string>` — declared as a stub throwing `"not implemented"` in this task, fully implemented in Task 4. This lets Task 5 (wiring) and this task be reviewed independently without forward references breaking the build.

- [ ] **Step 1: Write `lib/gemini-browser.ts` — context + login**

```typescript
import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROFILE_DIR = path.join(projectRoot, ".gemini-profile");
const GEMINI_URL = "https://gemini.google.com/app";

function profileDir(): string {
  return process.env.GEMINI_PROFILE_DIR ?? DEFAULT_PROFILE_DIR;
}

async function openContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(), {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

export async function loginGemini(): Promise<void> {
  const context = await openContext();
  try {
    const page = await context.newPage();
    await page.goto(GEMINI_URL);
    console.log("Log in to Gemini in the opened browser window, then press Enter here to finish...");
    await waitForEnter();
  } finally {
    await context.close();
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const input = page.getByRole("textbox", { name: /prompt|ask gemini|enter a prompt/i });
  try {
    await input.first().waitFor({ state: "visible", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function generateVideoViaBrowser(prompt: string): Promise<string> {
  throw new Error(`generateVideoViaBrowser: not implemented yet (prompt: ${prompt})`);
}

export const __internal = { openContext, isLoggedIn, GEMINI_URL };
```

- [ ] **Step 2: Write `scripts/gemini-login.ts`**

```typescript
import { loginGemini } from "../lib/gemini-browser.ts";

loginGemini().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Run it and log in manually**

Run: `npm run gemini:login`
Expected: a headed Chromium window opens at `gemini.google.com/app`. Log in with the Google account by hand in that window, then press Enter in the terminal. The script should exit 0 and the browser window should close.

- [ ] **Step 4: Verify the session persisted**

Run: `ls .gemini-profile`
Expected: non-empty directory (Chromium profile data written to disk).

- [ ] **Step 5: Commit**

```bash
git add lib/gemini-browser.ts scripts/gemini-login.ts
git commit -m "feat: add persistent Gemini browser login"
```

---

### Task 4: Implement the video generation flow

**Files:**
- Modify: `lib/gemini-browser.ts`
- Create: `scripts/gemini-test-video.ts` (throwaway manual debug entrypoint — lets us iterate on selectors without running the full pipeline)

**Interfaces:**
- Consumes: `__internal.openContext`, `__internal.isLoggedIn`, `__internal.GEMINI_URL` from Task 3's `lib/gemini-browser.ts`.
- Produces: `generateVideoViaBrowser(prompt: string): Promise<string>` fully implemented — this is what Task 5 wires into `veo-to-youtube.ts`.

- [ ] **Step 1: Replace the stub in `lib/gemini-browser.ts`**

Replace the `generateVideoViaBrowser` stub and add the helper functions below it in the same file:

```typescript
import { tmpdir } from "node:os";

const GENERATION_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 10_000;

async function selectVeoMode(page: Page): Promise<void> {
  // ponytail: selector guessed — gemini.google.com's DOM wasn't inspectable
  // while writing this. If this throws or clicks the wrong thing, run
  // `npx tsx scripts/gemini-test-video.ts "test prompt"` headed and fix the
  // locator here. See docs/superpowers/specs/2026-07-29-playwright-gemini-video-gen-design.md
  // "Known risk / open item" for context.
  const toolsButton = page.getByRole("button", { name: /tools|more/i });
  await toolsButton.click();
  const videoOption = page.getByRole("menuitemradio", { name: /video/i }).or(page.getByText(/^Video$/));
  await videoOption.first().click();
}

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  // ponytail: selector guessed, same caveat as selectVeoMode above.
  const input = page.getByRole("textbox", { name: /prompt|ask gemini|enter a prompt/i }).first();
  await input.click();
  await input.fill(prompt);
  await input.press("Enter");
}

async function waitForVideoReady(page: Page): Promise<void> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const downloadButton = page.getByRole("button", { name: /download/i });
    if (await downloadButton.first().isVisible().catch(() => false)) {
      return;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new Error(`waitForVideoReady: video not ready after ${GENERATION_TIMEOUT_MS / 1000}s`);
}

async function downloadVideo(page: Page): Promise<string> {
  // ponytail: selector guessed, same caveat as selectVeoMode above.
  const downloadButton = page.getByRole("button", { name: /download/i }).first();
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  const outputPath = path.join(tmpdir(), `veo-${Date.now()}.mp4`);
  await download.saveAs(outputPath);
  return outputPath;
}

export async function generateVideoViaBrowser(prompt: string): Promise<string> {
  const context = await openContext();
  try {
    const page = await context.newPage();
    await page.goto(GEMINI_URL);

    if (!(await isLoggedIn(page))) {
      throw new Error(
        "generateVideoViaBrowser: not logged in to Gemini. Run `npm run gemini:login` first.",
      );
    }

    await selectVeoMode(page);
    await submitPrompt(page, prompt);
    await waitForVideoReady(page);
    return await downloadVideo(page);
  } finally {
    await context.close();
  }
}
```

Remove the now-unused `__internal` export (it was only there so Task 3's file compiled standalone) — inline `openContext`, `isLoggedIn`, `GEMINI_URL` usage directly since they're all in the same file now.

- [ ] **Step 2: Write the manual debug entrypoint**

```typescript
// scripts/gemini-test-video.ts
import { generateVideoViaBrowser } from "../lib/gemini-browser.ts";

const prompt = process.argv[2] ?? "A close-up shot of a wooden toy car on a workshop table.";

generateVideoViaBrowser(prompt)
  .then((filePath) => console.log(`Video saved to: ${filePath}`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
```

- [ ] **Step 3: Run it and fix selectors against the live page**

Run: `npx tsx --env-file=.env scripts/gemini-test-video.ts "A close-up shot of a wooden toy car on a workshop table."`

Expected: headed Chromium opens, navigates to Gemini, selects video mode, submits the prompt, waits, downloads the result, and prints `Video saved to: <path>`.

This step will very likely fail on the first try — watch the browser window, see which step it stalls or errors on (`selectVeoMode`, `submitPrompt`, `waitForVideoReady`, or `downloadVideo`), open the browser's dev tools if needed to find the right role/text/label, and adjust that one locator. Repeat until a full run succeeds and a playable mp4 shows up at the printed path.

- [ ] **Step 4: Confirm the downloaded file is a real video**

Run: `open <path from previous step>` (macOS) — Expected: video plays and matches the prompt.

- [ ] **Step 5: Commit**

```bash
git add lib/gemini-browser.ts scripts/gemini-test-video.ts
git commit -m "feat: implement Gemini web video generation flow"
```

---

### Task 5: Wire into the pipeline, drop the Veo3 API path

**Files:**
- Modify: `scripts/veo-to-youtube.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `generateVideoViaBrowser(prompt: string): Promise<string>` from `lib/gemini-browser.ts` (Task 4).
- Produces: `generateVideo(prompt: string): Promise<string>` — same public signature as before, unchanged for `run-shorts-pipeline.ts`.

- [ ] **Step 1: Replace the video generation implementation**

In `scripts/veo-to-youtube.ts`, replace:

```typescript
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// ponytail: model id per Veo docs at time of writing, verify against
// https://ai.google.dev/gemini-api/docs/video before relying on it long-term.
const VEO_MODEL = process.env.VEO_MODEL ?? "veo-3.1-generate-preview";

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export async function generateVideo(prompt: string): Promise<string> {
  let operation = await ai.models.generateVideos({
    model: VEO_MODEL,
    prompt,
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) {
    throw new Error(`generateVideo: Veo API không trả về video (operation: ${JSON.stringify(operation)})`);
  }

  const outputPath = path.join(tmpdir(), `veo-${Date.now()}.mp4`);
  await ai.files.download({ file: video, downloadPath: outputPath });
  return outputPath;
}
```

with:

```typescript
import { createReadStream } from "node:fs";
import { google } from "googleapis";
import { generateVideoViaBrowser } from "../lib/gemini-browser.ts";

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export async function generateVideo(prompt: string): Promise<string> {
  return generateVideoViaBrowser(prompt);
}
```

Leave `uploadToYoutube` untouched below it.

- [ ] **Step 2: Update `.env.example`**

Remove the now-unused `VEO_MODEL` line (video generation no longer goes through the Veo3 API) and note that `GEMINI_API_KEY` is only for text metadata now:

```
# Gemini (text metadata gen only — video now generated via Playwright + gemini.google.com, see lib/gemini-browser.ts)
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=gemini-2.5-flash

# Gemini browser automation (optional override)
# GEMINI_PROFILE_DIR=.gemini-profile

# YouTube Data API v3 (OAuth2 refresh token flow)
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
# public | private | unlisted — defaults to "private" in code if unset
YOUTUBE_PRIVACY_STATUS=private
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `generateVideo`'s signature still matches what `run-shorts-pipeline.ts` expects, and no leftover references to the removed `@google/genai` import in this file).

- [ ] **Step 4: Commit**

```bash
git add scripts/veo-to-youtube.ts .env.example
git commit -m "refactor: generate video via Gemini browser instead of Veo3 API"
```

---

### Task 6: End-to-end pipeline verification

**Files:**
- None (verification only; fix forward in whichever file if something breaks).

**Interfaces:**
- None — this exercises the full `npm run pipeline` flow already wired in prior tasks.

- [ ] **Step 1: Run the full pipeline**

Run: `npm run pipeline`

Expected: picks a car, opens headed Chromium, generates the video via Gemini, downloads it, generates YouTube metadata via the API, uploads the video as an unlisted/private YouTube video, and prints `Published: https://youtu.be/...`.

- [ ] **Step 2: Confirm the upload**

Open the printed YouTube URL. Expected: video plays, title/description/tags match what `generateMetadata` produced, privacy status matches `YOUTUBE_PRIVACY_STATUS` in `.env`.

- [ ] **Step 3: Fix forward if anything broke**

If any step failed, fix it in the relevant file (most likely a selector in `lib/gemini-browser.ts`), re-run from Step 1, and commit the fix:

```bash
git add -A
git commit -m "fix: <what broke>"
```

- [ ] **Step 4: Final commit if everything passed clean**

If Step 1 passed with no code changes needed, there's nothing to commit — this task is done.
