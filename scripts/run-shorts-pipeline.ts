import { readFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickNextCar } from "../lib/car-picker.ts";
import { generateMetadata } from "../lib/generate-metadata.ts";
import { generateVideo, uploadToYoutube } from "./veo-to-youtube.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const veoTemplatePath = path.join(projectRoot, "prompt-veo3.md");
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

async function confirmVideo(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Video ok? (y = tiếp tục upload, n = tạo lại): ");
    return /^y/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const car = await pickNextCar();
  console.log(`Car: ${car}`);

  const veoTemplate = await readFile(veoTemplatePath, "utf-8");
  const veoPrompt = veoTemplate.replaceAll("{CAR_MODEL}", car);

  let videoPath: string;
  while (true) {
    videoPath = await generateVideo(veoPrompt);
    console.log(`Video generated: ${videoPath}`);

    await previewVideo(videoPath);
    const approved = await confirmVideo();
    if (approved) break;

    console.log("Rejected, regenerating video...");
    await unlink(videoPath);
  }

  const metadata = await generateMetadata(car);
  console.log(`Metadata generated: ${metadata.title}`);

  const videoUrl = await uploadToYoutube(videoPath, metadata);
  await unlink(videoPath);

  console.log(`Published: ${videoUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
