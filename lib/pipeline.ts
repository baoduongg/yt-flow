import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickNextCar } from "./car-picker.ts";
import { generateMetadata, type VideoMetadata } from "./generate-metadata.ts";
import { generateVideo, uploadToYoutube } from "../scripts/veo-to-youtube.ts";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const veoTemplatePath = path.join(projectRoot, "prompt-veo3.md");
const carsPoolPath = path.join(projectRoot, "data", "cars.json");

export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
  confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>;
};

export type PipelineOptions = {
  carOverride?: string;
};

export type PipelineResult = {
  car: string;
  videoUrl: string;
};

export type PipelineDeps = {
  pickNextCar: () => Promise<string>;
  generateVideo: (prompt: string) => Promise<string>;
  generateMetadata: (car: string) => Promise<VideoMetadata>;
  uploadToYoutube: (videoPath: string, meta: VideoMetadata) => Promise<string>;
  unlink: (path: string) => Promise<void>;
};

export const defaultDeps: PipelineDeps = {
  pickNextCar,
  generateVideo,
  generateMetadata,
  uploadToYoutube,
  unlink,
};

async function resolveCar(carOverride: string | undefined, deps: PipelineDeps): Promise<string> {
  if (!carOverride) return deps.pickNextCar();

  const pool = JSON.parse(await readFile(carsPoolPath, "utf-8")) as string[];
  const match = pool.find((c) => c.toLowerCase() === carOverride.toLowerCase());
  if (!match) {
    throw new Error(`Không tìm thấy xe "${carOverride}" trong data/cars.json`);
  }
  return match;
}

export async function runPipeline(
  options: PipelineOptions,
  hooks: PipelineHooks,
  deps: PipelineDeps = defaultDeps,
): Promise<PipelineResult> {
  const car = await resolveCar(options.carOverride, deps);
  hooks.onStep?.(`Xe: ${car}`);

  const veoTemplate = await readFile(veoTemplatePath, "utf-8");
  const veoPrompt = veoTemplate.replaceAll("{CAR_MODEL}", car);

  let videoPath: string;
  while (true) {
    hooks.onStep?.("Đang tạo video bằng Gemini (Veo3), có thể mất vài phút...");
    videoPath = await deps.generateVideo(veoPrompt);
    hooks.onStep?.(`Video đã tạo xong: ${videoPath}`);

    const approved = await hooks.confirmVideo(videoPath);
    if (approved) break;

    hooks.onStep?.("Bị từ chối, đang tạo lại video...");
    await deps.unlink(videoPath);
  }

  hooks.onStep?.("Đang tạo tiêu đề/mô tả/tag cho YouTube...");
  const metadata = await deps.generateMetadata(car);
  hooks.onStep?.(`Metadata đã sinh xong: ${metadata.title}`);
  const finalMetadata = hooks.confirmMetadata ? await hooks.confirmMetadata(metadata) : metadata;

  hooks.onStep?.("Đang upload video lên YouTube...");
  const videoUrl = await deps.uploadToYoutube(videoPath, finalMetadata);
  await deps.unlink(videoPath);
  hooks.onStep?.(`Đã đăng: ${videoUrl}`);

  return { car, videoUrl };
}
