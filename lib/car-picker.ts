import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const poolPath = path.join(dataDir, "cars.json");
const queuePath = path.join(dataDir, "cars-queue.json");

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function readQueue(): Promise<string[]> {
  try {
    const raw = await readFile(queuePath, "utf-8");
    return JSON.parse(raw) as string[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function pickNextCar(): Promise<string> {
  let queue = await readQueue();

  if (queue.length === 0) {
    const pool = JSON.parse(await readFile(poolPath, "utf-8")) as string[];
    queue = shuffle(pool);
  }

  const index = Math.floor(Math.random() * queue.length);
  const [car] = queue.splice(index, 1);
  await writeFile(queuePath, JSON.stringify(queue, null, 2));
  return car;
}
