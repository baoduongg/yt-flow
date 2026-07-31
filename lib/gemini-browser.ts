import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROFILE_DIR = path.join(projectRoot, ".gemini-profile");
const OUTPUT_DIR = path.join(projectRoot, "output");
const GEMINI_URL = "https://gemini.google.com/app";

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
  // Confirmed live via scripts/gemini-inspect.ts (2026-07-31): Google killed the
  // /videos deep link — it now redirects to the bare gemini.google.com root, a
  // blank shell with no composer (this is the "trang trắng" bug). Video mode is
  // now enabled from /app itself via the composer's tools menu: the "Nội dung
  // tải lên và công cụ" button opens a menu with a "Tạo video" checkbox item.
  // If Google changes this again, re-run gemini-inspect.ts against /app and
  // open that tools menu to see the new structure.
  const understandButton = page.getByRole("button", { name: /tôi hiểu|got it/i });
  if (await understandButton.first().isVisible().catch(() => false)) {
    await understandButton.first().click();
    await page.waitForTimeout(500);
  }
  const toolsButton = page.getByRole("button", { name: /nội dung tải lên và công cụ|upload.*tools/i });
  await toolsButton.first().click();
  const videoOption = page.getByRole("menuitemcheckbox", { name: /tạo video|create video/i });
  await videoOption.first().click();
  await page.waitForTimeout(1000);
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

// Text seen on Gemini's own error toast/banner when generation can't proceed
// (quota exhausted, content blocked, etc). Best-effort match — Google can
// reword this; re-run scripts/gemini-inspect-result.ts against a triggered
// error to check the live text if this stops catching something.
//
// "nâng cấp" alone is NOT safe here: Gemini's top bar always has a persistent
// "Nâng cấp" (upgrade to Advanced) link on every page, so a bare match false-
// positives on every single run, seconds after submit. Require the trailing
// "để ..." Google attaches to an actual quota-upsell message so the nav CTA
// (just the two words "Nâng cấp") can't match.
const GENERATION_ERROR_TEXT =
  /out of videos|upgrade to keep creating|something went wrong|unable to (create|generate)|hết lượt|nâng cấp để|đã xảy ra lỗi/i;

async function checkForGenerationError(page: Page): Promise<string | null> {
  const errorLocator = page.getByText(GENERATION_ERROR_TEXT);
  if (!(await errorLocator.first().isVisible().catch(() => false))) return null;
  const text = await errorLocator.first().innerText().catch(() => null);
  return text?.trim() || "Gemini báo lỗi khi tạo video (không đọc được nội dung chi tiết).";
}

async function waitForVideoReady(page: Page): Promise<void> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const downloadButton = page.getByRole("button", { name: DOWNLOAD_BUTTON_NAME });
    if (await downloadButton.first().isVisible().catch(() => false)) {
      return;
    }
    const errorText = await checkForGenerationError(page);
    if (errorText) {
      throw new Error(`Gemini báo lỗi khi tạo video: ${errorText}`);
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new Error(`waitForVideoReady: video not ready after ${GENERATION_TIMEOUT_MS / 1000}s`);
}

// ponytail: automation runs faster than a human can watch the visible browser
// window, so on failure the only evidence is this log + a screenshot taken
// right before the context closes — check output/gemini-error-*.png.
async function withStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  console.log(`[gemini] ${label}...`);
  const result = await fn();
  console.log(`[gemini] ${label}: xong`);
  return result;
}

async function saveErrorScreenshot(page: Page): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const screenshotPath = path.join(OUTPUT_DIR, `gemini-error-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
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
  let page: Page | undefined;
  try {
    page = await context.newPage();
    await page.goto(GEMINI_URL);

    if (!(await isLoggedIn(page))) {
      throw new Error(
        "generateVideoViaBrowser: not logged in to Gemini. Run `npm run gemini:login` first.",
      );
    }

    await withStep("Bật chế độ Video", () => selectVeoMode(page!));
    await withStep("Chọn tỷ lệ khung hình dọc", () => selectVerticalAspectRatio(page!));
    await withStep("Gửi prompt", () => submitPrompt(page!, prompt));

    // Check right away too — a quota/content error toast can appear and
    // fade before the first poll in waitForVideoReady would catch it.
    await page.waitForTimeout(2000);
    const earlyError = await checkForGenerationError(page);
    if (earlyError) {
      throw new Error(`Gemini báo lỗi khi tạo video: ${earlyError}`);
    }

    await withStep("Chờ video tạo xong", () => waitForVideoReady(page!));
    return await withStep("Tải video xuống", () => downloadVideo(page!));
  } catch (err) {
    if (page) {
      const screenshotPath = await saveErrorScreenshot(page).catch(() => null);
      const suffix = screenshotPath ? ` (screenshot: ${screenshotPath})` : "";
      throw new Error(`${(err as Error).message}${suffix}`);
    }
    throw err;
  } finally {
    await context.close();
  }
}
