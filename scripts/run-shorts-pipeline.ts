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
