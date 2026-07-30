import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROFILE_DIR = path.join(projectRoot, ".gemini-profile");
const OUTPUT_DIR = path.join(projectRoot, "output");
const GEMINI_URL = "https://gemini.google.com/app";
const GEMINI_VIDEO_URL = "https://gemini.google.com/videos";

function profileDir(): string {
  return process.env.GEMINI_PROFILE_DIR ?? DEFAULT_PROFILE_DIR;
}

async function openContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(), {
    headless: false,
    viewport: { width: 1280, height: 900 },
    // ponytail: Google blocks Playwright's bundled Chromium on the sign-in
    // page ("This browser or app may not be secure") because its fingerprint
    // differs from real Chrome. Driving actual installed Chrome + stripping
    // the automation flag Chromium adds by default avoids that block.
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
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
  // The composer textbox's accessible name is locale-dependent (e.g.
  // Vietnamese "Nhập câu lệnh cho Gemini"), so match by role only, scoped to
  // <main> to avoid picking up an unrelated textbox elsewhere on the page.
  const input = page.getByRole("main").getByRole("textbox").first();
  try {
    await input.waitFor({ state: "visible", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const GENERATION_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 10_000;

async function selectVeoMode(page: Page): Promise<void> {
  // Confirmed live via scripts/gemini-inspect.ts (2026-07-30): "Video" isn't
  // a menu item on /app — visiting /videos redirects back to /app with the
  // composer's Video toggle already on, after a one-time "Dùng thử"/"Try it"
  // intro dialog. If Google changes this flow, re-run gemini-inspect.ts
  // against /videos to see the new structure.
  await page.goto(GEMINI_VIDEO_URL);
  await page.waitForTimeout(3000);
  const tryButton = page.getByRole("button", { name: /dùng thử|try it|try/i });
  if (await tryButton.first().isVisible().catch(() => false)) {
    await tryButton.first().click();
    await page.waitForTimeout(1000);
  }
}

async function selectVerticalAspectRatio(page: Page): Promise<void> {
  // Confirmed live via scripts/gemini-inspect-ratio.ts (2026-07-30): the
  // composer defaults to landscape 16:9, wrong for YouTube Shorts. Opening
  // the aspect-ratio button shows a menu of menuitemradio options; the
  // vertical one is labeled "Dọc (9:16)" on this Vietnamese-locale account.
  const ratioButton = page.getByRole("button", { name: /tỷ lệ khung hình|aspect ratio/i });
  await ratioButton.first().click();
  const verticalOption = page.getByRole("menuitemradio", { name: /9:16|dọc|vertical|portrait/i });
  await verticalOption.first().click();
}

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  // Same locale-independent textbox match as isLoggedIn above.
  const input = page.getByRole("main").getByRole("textbox").first();
  await input.click();
  await input.fill(prompt);
  await input.press("Enter");
}

// Confirmed live via scripts/gemini-inspect-result.ts (2026-07-30): the
// button's accessible name is locale-dependent — "Download video" in
// English, "Tải video xuống" on this Vietnamese-locale account. Match both;
// re-run gemini-inspect-result.ts if a different locale breaks this.
const DOWNLOAD_BUTTON_NAME = /download|tải.*xuống/i;

async function waitForVideoReady(page: Page): Promise<void> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const downloadButton = page.getByRole("button", { name: DOWNLOAD_BUTTON_NAME });
    if (await downloadButton.first().isVisible().catch(() => false)) {
      return;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new Error(`waitForVideoReady: video not ready after ${GENERATION_TIMEOUT_MS / 1000}s`);
}

async function downloadVideo(page: Page): Promise<string> {
  const downloadButton = page.getByRole("button", { name: DOWNLOAD_BUTTON_NAME }).first();
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `veo-${Date.now()}.mp4`);
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
    await selectVerticalAspectRatio(page);
    await submitPrompt(page, prompt);
    await waitForVideoReady(page);
    return await downloadVideo(page);
  } finally {
    await context.close();
  }
}
