import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
