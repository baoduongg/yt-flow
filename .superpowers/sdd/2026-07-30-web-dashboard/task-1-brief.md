### Task 1: `confirmMetadata` hook on the pipeline core

**Files:**
- Modify: `lib/pipeline.ts:12-15` (hook type), `lib/pipeline.ts:76-84` (call site)
- Modify: `lib/pipeline.test.ts` (append new test)

**Interfaces:**
- Produces: `PipelineHooks.confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>` — optional; when omitted, `runPipeline` uploads the metadata `generateMetadata` returned, unchanged from current behavior.

- [ ] **Step 1: Write the failing test**

Append to `lib/pipeline.test.ts` (before the final closing of the file, as a new `test(...)` block alongside the existing three):

```ts
test("confirmMetadata edits metadata before upload", async () => {
  const deps = makeDeps();
  const uploaded: VideoMetadata[] = [];
  deps.uploadToYoutube = async (_path, meta) => {
    uploaded.push(meta);
    return "https://youtu.be/edited";
  };

  const result = await runPipeline(
    {},
    {
      confirmVideo: async () => true,
      confirmMetadata: async (meta) => ({ ...meta, title: "Edited Title" }),
    },
    deps,
  );

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].title, "Edited Title");
  assert.equal(result.videoUrl, "https://youtu.be/edited");
});
```

Add the missing import at the top of `lib/pipeline.test.ts`:

```ts
import type { VideoMetadata } from "./generate-metadata.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: FAIL — `uploaded[0].title` is `"t"` (the mock's default), not `"Edited Title"`, because `confirmMetadata` isn't wired into `runPipeline` yet.

- [ ] **Step 3: Implement**

In `lib/pipeline.ts`, change the hooks type (currently lines 12-15):

```ts
export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
  confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>;
};
```

Then change the metadata/upload section (currently lines 76-84):

```ts
  hooks.onStep?.("Đang tạo tiêu đề/mô tả/tag cho YouTube...");
  const metadata = await deps.generateMetadata(car);
  hooks.onStep?.(`Metadata đã sinh xong: ${metadata.title}`);
  const finalMetadata = hooks.confirmMetadata ? await hooks.confirmMetadata(metadata) : metadata;

  hooks.onStep?.("Đang upload video lên YouTube...");
  const videoUrl = await deps.uploadToYoutube(videoPath, finalMetadata);
  await deps.unlink(videoPath);
  hooks.onStep?.(`Đã đăng: ${videoUrl}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/pipeline.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.ts lib/pipeline.test.ts
git commit -m "feat: add optional confirmMetadata hook to pipeline core"
```

---

