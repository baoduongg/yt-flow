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
