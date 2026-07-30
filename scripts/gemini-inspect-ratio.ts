import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.GEMINI_PROFILE_DIR ?? path.join(projectRoot, ".gemini-profile");

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  channel: "chrome",
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});

const page = await context.newPage();
await page.goto("https://gemini.google.com/videos");
await page.waitForTimeout(3000);

const tryButton = page.getByRole("button", { name: /dùng thử|try it|try/i });
if (await tryButton.first().isVisible().catch(() => false)) {
  await tryButton.first().click();
  await page.waitForTimeout(1000);
}

const ratioButton = page.getByRole("button", { name: /tỷ lệ khung hình|aspect ratio/i });
await ratioButton.first().click();
await page.waitForTimeout(1000);

console.log("=== ARIA SNAPSHOT after clicking aspect ratio button ===");
console.log(await page.locator("body").ariaSnapshot());

await context.close();
