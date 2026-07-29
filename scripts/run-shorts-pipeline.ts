import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickNextCar } from "../lib/car-picker.ts";
import { generateMetadata } from "../lib/generate-metadata.ts";
import { generateVideo, uploadToYoutube } from "./veo-to-youtube.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const veoTemplatePath = path.join(projectRoot, "prompt-veo3.md");

async function main(): Promise<void> {
  const car = await pickNextCar();
  console.log(`Car: ${car}`);

  const veoTemplate = await readFile(veoTemplatePath, "utf-8");
  const veoPrompt = veoTemplate.replaceAll("{CAR_MODEL}", car);

  const videoPath = await generateVideo(veoPrompt);
  console.log(`Video generated: ${videoPath}`);

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
