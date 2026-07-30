### Task 3: job state machine wrapping `runPipeline`

**Files:**
- Create: `lib/test-support.ts` (shared mock deps, extracted from `lib/pipeline.test.ts`)
- Modify: `lib/pipeline.test.ts` (use the shared helper instead of its local one)
- Create: `lib/web-job.ts`
- Create: `lib/web-job.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `defaultDeps`, `type PipelineDeps` from `./pipeline.ts`; `type VideoMetadata` from `./generate-metadata.ts`.
- Produces:
  - `type JobState = { phase: "idle" } | { phase: "running"; car: string; step: string } | { phase: "awaiting-video"; car: string; videoPath: string } | { phase: "awaiting-metadata"; car: string; metadata: VideoMetadata } | { phase: "done"; car: string; youtubeUrl: string } | { phase: "error"; message: string }`
  - `type JobRunner = { getState(): JobState; subscribe(listener: (state: JobState) => void): () => void; start(carOverride?: string): boolean; decideVideo(approved: boolean): boolean; decideMetadata(metadata: VideoMetadata): boolean }`
  - `createJobRunner(deps?: PipelineDeps): JobRunner`

- [ ] **Step 1: Extract the shared mock deps (no behavior change yet)**

Create `lib/test-support.ts`:

```ts
import type { PipelineDeps } from "./pipeline.ts";

export type MockDeps = PipelineDeps & {
  calls: { generateVideo: number; unlink: number; uploadToYoutube: number; generateMetadata: number };
};

export function makeMockDeps(): MockDeps {
  const calls = { generateVideo: 0, unlink: 0, uploadToYoutube: 0, generateMetadata: 0 };
  return {
    calls,
    pickNextCar: async () => "Test Car",
    generateVideo: async () => {
      calls.generateVideo++;
      return `/tmp/video-${calls.generateVideo}.mp4`;
    },
    generateMetadata: async () => {
      calls.generateMetadata++;
      return { title: "t", description: "d", tags: [] };
    },
    uploadToYoutube: async () => {
      calls.uploadToYoutube++;
      return "https://youtu.be/test";
    },
    unlink: async () => {
      calls.unlink++;
    },
  };
}
```

In `lib/pipeline.test.ts`, replace the local `makeDeps` function and its `PipelineDeps` import with:

```ts
import { runPipeline } from "./pipeline.ts";
import { makeMockDeps } from "./test-support.ts";
import type { VideoMetadata } from "./generate-metadata.ts";
```

and replace every call site of `makeDeps()` in that file with `makeMockDeps()`. Delete the now-unused local `makeDeps` function definition entirely.

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: all 4 tests still PASS (pure refactor, no behavior change).

- [ ] **Step 2: Commit the refactor separately**

```bash
git add lib/test-support.ts lib/pipeline.test.ts
git commit -m "refactor: extract shared pipeline mock deps into lib/test-support.ts"
```

- [ ] **Step 3: Write the failing test for the job runner**

Create `lib/web-job.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobRunner, type JobRunner, type JobState } from "./web-job.ts";
import { makeMockDeps } from "./test-support.ts";

function waitForPhase(runner: JobRunner, phase: JobState["phase"]): Promise<JobState> {
  return new Promise((resolve) => {
    const unsubscribe = runner.subscribe((state) => {
      if (state.phase === phase) {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

test("start() goes idle -> running -> awaiting-video -> awaiting-metadata -> done", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  assert.equal(runner.getState().phase, "idle");

  assert.equal(runner.start(), true);
  const awaitingVideo = await waitForPhase(runner, "awaiting-video");
  assert.equal(awaitingVideo.phase, "awaiting-video");

  const awaitingMetadata = waitForPhase(runner, "awaiting-metadata");
  assert.equal(runner.decideVideo(true), true);
  await awaitingMetadata;

  const done = waitForPhase(runner, "done");
  assert.equal(runner.decideMetadata({ title: "Edited", description: "d", tags: [] }), true);
  const finalState = await done;
  assert.equal(finalState.phase, "done");
  assert.equal(deps.calls.uploadToYoutube, 1);
});

test("start() returns false while a job is already busy", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  runner.start();
  await waitForPhase(runner, "awaiting-video");
  assert.equal(runner.start(), false);
});

test("decideVideo(false) regenerates the video before reaching awaiting-metadata", async () => {
  const deps = makeMockDeps();
  const runner = createJobRunner(deps);
  runner.start();
  await waitForPhase(runner, "awaiting-video");

  const secondAwaitingVideo = waitForPhase(runner, "awaiting-video");
  assert.equal(runner.decideVideo(false), true);
  await secondAwaitingVideo;

  assert.equal(deps.calls.generateVideo, 2);
});

test("decideVideo/decideMetadata return false when nothing is pending", () => {
  const runner = createJobRunner(makeMockDeps());
  assert.equal(runner.decideVideo(true), false);
  assert.equal(runner.decideMetadata({ title: "", description: "", tags: [] }), false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx --test lib/web-job.test.ts`
Expected: FAIL — `lib/web-job.ts` doesn't exist yet.

- [ ] **Step 5: Implement**

Create `lib/web-job.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test lib/web-job.test.ts`
Expected: all 4 tests PASS.

Run: `npm test`
Expected: all tests across `lib/*.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/web-job.ts lib/web-job.test.ts
git commit -m "feat: add in-memory job state machine wrapping runPipeline"
```

---

