# Web dashboard cho pipeline

Ngày: 2026-07-30
Trạng thái: Approved (chờ viết plan)

## Mục tiêu

Hiện có 2 cách chạy pipeline: CLI (`npm run pipeline`, chặn terminal, cần
gõ y/n) và Telegram bot (điều khiển từ xa). Người dùng muốn thêm 1 giao
diện web local để: setup key trong `.env`, xem danh sách xe gợi ý, bấm
generate, xem loading/progress, preview video ngay trong trình duyệt,
duyệt/từ chối, xem và sửa metadata trước khi upload YouTube.

## Kiến trúc

Server mới `scripts/web-server.ts` (Express, dependency mới duy nhất:
`express`). Serve static frontend từ `public/` — HTML/CSS/JS thuần, không
build step, khớp mức độ đơn giản của các script hiện có.

Tái dùng `lib/pipeline.ts` — `runPipeline()` — y hệt CLI/bot, không viết
lại logic nghiệp vụ. Chỉ chạy song song, độc lập với CLI/bot: không chia
sẻ state process, người dùng tự biết chỉ chạy 1 driver (CLI hoặc bot hoặc
web) tại 1 thời điểm để tránh tranh nhau `data/cars-queue.json`.

Server bind `127.0.0.1` mặc định (`WEB_PORT`, mặc định `3000`), không auth
— công cụ local 1 người dùng.

## Thay đổi `lib/pipeline.ts`

Thêm 1 hook mới, optional, không phá vỡ CLI/bot hiện có:

```ts
export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
  confirmMetadata?: (meta: VideoMetadata) => Promise<VideoMetadata>;
};
```

Trong `runPipeline`, sau khi `generateMetadata` xong:

```ts
const metadata = await deps.generateMetadata(car);
hooks.onStep?.(`Metadata đã sinh xong: ${metadata.title}`);
const finalMetadata = hooks.confirmMetadata
  ? await hooks.confirmMetadata(metadata)
  : metadata;
```

`finalMetadata` dùng cho `uploadToYoutube`. CLI (`run-shorts-pipeline.ts`)
và bot (`telegram-bot.ts`) không truyền hook này — hành vi giữ nguyên y hệt
hiện tại (upload thẳng metadata gốc).

## State & luồng dữ liệu

Server giữ 1 job state trong bộ nhớ tiến trình, tương tự
`telegram-bot.ts`:

```ts
type JobState =
  | { phase: "idle" }
  | { phase: "running"; car: string; step: string }
  | { phase: "awaiting-video"; car: string; videoUrl: string }
  | { phase: "awaiting-metadata"; car: string; metadata: VideoMetadata }
  | { phase: "done"; car: string; youtubeUrl: string }
  | { phase: "error"; message: string };
```

Chỉ 1 pipeline chạy tại 1 thời điểm — `POST /api/generate` khi đang
`running`/`awaiting-*` trả `409`.

SSE (`GET /api/events`) push mỗi lần `JobState` đổi. Khi client vừa kết
nối, server gửi ngay `JobState` hiện tại làm event đầu tiên (để reload
trang giữa chừng không mất context, không cần localStorage hay DB).

## API endpoints

- `GET /api/config` — đọc `.env`, trả về từng key kèm cờ đã-set + giá trị
  mask (`AIza****xyz`, giữ 4 ký tự đầu/cuối). Không bao giờ trả plaintext
  qua GET.
- `POST /api/config` — nhận `{ key: value }` cho các field có nhập (field
  để trống nghĩa là giữ nguyên giá trị cũ), ghi đè `.env`, parse lại file
  và `Object.assign(process.env, parsed)` để áp dụng ngay, không cần
  restart server.
- `GET /api/cars` — `{ queue: string[], pool: string[] }` đọc trực tiếp
  `data/cars-queue.json` và `data/cars.json` (không mutate).
- `POST /api/generate` — body `{ car?: string }`. Rảnh → set `running`,
  gọi `runPipeline({ carOverride: car }, hooks)` không chặn response, trả
  `202`. Bận → trả `409` kèm state hiện tại.
- `POST /api/video-decision` — body `{ approved: boolean }`. Resolve
  `confirmVideo` đang chờ. Không có pending → `409`.
- `POST /api/metadata-decision` — body `{ title, description, tags }`.
  Resolve `confirmMetadata` đang chờ bằng giá trị đã sửa. Không có
  pending → `409`.
- `GET /media/:filename` — static serve video từ thư mục `output/` (chặn
  path traversal bằng `path.basename`, chỉ phục vụ file nằm trực tiếp
  trong `output/`).

## Frontend (`public/`, vanilla JS, 1 trang)

`index.html` + `app.js` + `style.css`, không framework, không bundler.
Các section theo đúng thứ tự luồng, ẩn/hiện theo `phase` nhận từ SSE:

1. **Setup** — form các key trong `.env` (mask giá trị cũ, để trống =
   giữ nguyên), nút Lưu gọi `POST /api/config`.
2. **Cars** — hiện `queue` hiện tại, dropdown/list chọn 1 xe từ `pool` để
   override, nút "Generate" (dùng xe đã chọn hoặc để trống dùng
   `pickNextCar()` mặc định).
3. **Progress** — log các dòng `onStep` nhận qua SSE, hiện khi
   `phase === "running"`.
4. **Video preview** — `phase === "awaiting-video"`: thẻ
   `<video controls src="/media/...">`, 2 nút Duyệt/Từ chối gọi
   `POST /api/video-decision`.
5. **Metadata edit** — `phase === "awaiting-metadata"`: form
   title/description/tags điền sẵn giá trị sinh ra, sửa tay tự do, nút
   Upload gọi `POST /api/metadata-decision` với giá trị hiện tại trong
   form.
6. **Kết quả** — `phase === "done"`: link YouTube. `phase === "error"`:
   thông báo lỗi. Cả 2 đều có nút quay lại section Cars để generate tiếp.

## Error handling

- Lỗi bất kỳ bước nào trong `runPipeline` (throw từ `generateVideo`/
  `generateMetadata`/`uploadToYoutube`) → catch quanh lời gọi trong
  `web-server.ts`, set `phase: "error"`, push SSE, không crash server.
  Không tự động retry — người dùng bấm Generate lại từ đầu.
- `carOverride` không hợp lệ → `runPipeline` throw trước khi sinh video,
  xử lý giống lỗi thường (state `error`).
- Ghi `.env` lỗi (không parse được) → `POST /api/config` trả `400`, không
  ghi đè file gốc.
- `GET /media/:filename` với path traversal hoặc file không tồn tại →
  `404`, không đọc ngoài `output/`.

## Testing

- `lib/pipeline.test.ts`: thêm case cho `confirmMetadata` — hook trả về
  metadata đã sửa, assert `uploadToYoutube` được gọi với đúng bản đã sửa
  (không phải bản gốc từ `generateMetadata`).
- `scripts/web-server.ts` và `public/`: test tay bằng cách chạy
  `npm run web` và thao tác qua trình duyệt thật — không viết
  integration test cho lớp HTTP/SSE mỏng này (giống cách
  `telegram-bot.ts` test tay qua bot thật).

## Ngoài phạm vi (out of scope)

- Nhiều pipeline chạy song song / hàng đợi lệnh generate (từ chối bằng
  `409` khi đang bận, không queue).
- Auth/đăng nhập cho web UI (công cụ local 1 người dùng).
- Nút "Sinh lại metadata" gọi lại Gemini (chỉ sửa tay).
- Đồng bộ state giữa web/CLI/bot khi chạy đồng thời (người dùng tự đảm
  bảo chỉ chạy 1 driver tại 1 thời điểm).
