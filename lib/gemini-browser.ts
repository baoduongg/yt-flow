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
