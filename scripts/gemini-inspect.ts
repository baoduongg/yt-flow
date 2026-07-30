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
const target = process.argv[2] ?? "https://gemini.google.com/app";
await page.goto(target);
await page.waitForTimeout(6000);

console.log("=== URL (before dismiss) ===");
console.log(page.url());
console.log("=== ARIA SNAPSHOT (before dismiss) ===");
console.log(await page.locator("body").ariaSnapshot());

const tryButton = page.getByRole("button", { name: /dùng thử|try/i });
if (await tryButton.first().isVisible().catch(() => false)) {
  await tryButton.first().click();
  await page.waitForTimeout(3000);
  console.log("=== URL (after dismiss) ===");
  console.log(page.url());
  console.log("=== ARIA SNAPSHOT (after dismiss) ===");
  console.log(await page.locator("body").ariaSnapshot());
}

await context.close();
