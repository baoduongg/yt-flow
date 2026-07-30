import { defaultDeps, runPipeline, type PipelineDeps } from "./pipeline.ts";
import type { VideoMetadata } from "./generate-metadata.ts";

export type JobState =
  | { phase: "idle" }
  | { phase: "running"; car: string; step: string }
  | { phase: "awaiting-video"; car: string; videoPath: string }
  | { phase: "awaiting-metadata"; car: string; metadata: VideoMetadata }
  | { phase: "done"; car: string; youtubeUrl: string }
  | { phase: "error"; message: string };

export type JobRunner = {
  getState: () => JobState;
  subscribe: (listener: (state: JobState) => void) => () => void;
  start: (carOverride?: string) => boolean;
  decideVideo: (approved: boolean) => boolean;
  decideMetadata: (metadata: VideoMetadata) => boolean;
};

export function createJobRunner(deps: PipelineDeps = defaultDeps): JobRunner {
  let state: JobState = { phase: "idle" };
  let currentCar = "";
  const listeners = new Set<(state: JobState) => void>();
  let pendingVideoResolve: ((approved: boolean) => void) | null = null;
  let pendingMetadataResolve: ((metadata: VideoMetadata) => void) | null = null;

  function setState(next: JobState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function isBusy(): boolean {
    return state.phase === "running" || state.phase === "awaiting-video" || state.phase === "awaiting-metadata";
  }

  function start(carOverride?: string): boolean {
    if (isBusy()) return false;

    currentCar = carOverride ?? "(đang chọn...)";
    setState({ phase: "running", car: currentCar, step: "Bắt đầu" });

    runPipeline(
      { carOverride },
      {
        onStep: (message) => {
          if (message.startsWith("Xe: ")) currentCar = message.slice("Xe: ".length);
          setState({ phase: "running", car: currentCar, step: message });
        },
        confirmVideo: (videoPath) =>
          new Promise<boolean>((resolve) => {
            pendingVideoResolve = resolve;
            setState({ phase: "awaiting-video", car: currentCar, videoPath });
          }),
        confirmMetadata: (metadata) =>
          new Promise<VideoMetadata>((resolve) => {
            pendingMetadataResolve = resolve;
            setState({ phase: "awaiting-metadata", car: currentCar, metadata });
          }),
      },
      deps,
    )
      .then((result) => {
        setState({ phase: "done", car: result.car, youtubeUrl: result.videoUrl });
      })
      .catch((err) => {
        setState({ phase: "error", message: (err as Error).message });
      })
      .finally(() => {
        pendingVideoResolve = null;
        pendingMetadataResolve = null;
      });

    return true;
  }

  function decideVideo(approved: boolean): boolean {
    if (!pendingVideoResolve) return false;
    pendingVideoResolve(approved);
    pendingVideoResolve = null;
    return true;
  }

  function decideMetadata(metadata: VideoMetadata): boolean {
    if (!pendingMetadataResolve) return false;
    pendingMetadataResolve(metadata);
    pendingMetadataResolve = null;
    return true;
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    decideVideo,
    decideMetadata,
  };
}
