# Điều khiển pipeline qua Telegram

Ngày: 2026-07-30
Trạng thái: Approved (chờ viết plan)

## Mục tiêu

Hiện tại `npm run pipeline` phải chạy trong terminal và yêu cầu người dùng
gõ `y`/`n` để duyệt video trước khi upload lên YouTube. Người dùng muốn điều
khiển toàn bộ quy trình (trigger chạy, duyệt/từ chối video, xem trạng thái)
từ xa qua Telegram, không cần mở terminal, kể cả khi không ngồi máy.

## Kiến trúc

Tách logic pipeline hiện có trong `scripts/run-shorts-pipeline.ts` thành một
lõi dùng chung `lib/pipeline.ts`. Lõi nhận vào các callback cho điểm tương
tác với người dùng (preview + duyệt video) thay vì gọi thẳng `readline`,
nhờ đó cả CLI cũ và bot Telegram mới đều dùng chung một luồng nghiệp vụ,
không lặp code.

Hai driver:

- `scripts/run-shorts-pipeline.ts` (giữ nguyên hành vi cũ) — dùng
  `lib/pipeline.ts` với hook confirm bằng `readline` y/n như hiện tại.
- `scripts/telegram-bot.ts` (mới) — process nền chạy liên tục (long-polling
  qua thư viện `grammy`), lắng nghe lệnh Telegram và dùng `lib/pipeline.ts`
  với hook confirm bằng nút inline Duyệt/Làm lại.

Bot chạy trên chính máy đang có Chrome profile Gemini đăng nhập sẵn
(`.gemini-profile/`), vì bước sinh video vẫn dựa vào Playwright điều khiển
`gemini.google.com` bằng phiên đăng nhập cục bộ — không thể tách sang server
khác mà không copy profile đó. Máy có thể là macOS hoặc Windows (Node +
Playwright + grammy đều cross-platform). Giữ process sống nền bằng `pm2`
(cross-platform, cài qua npm, không cần script riêng cho từng OS) — việc
này thuộc phần vận hành/README, không phải code cần viết.

## Components & data flow

### `lib/pipeline.ts`

```ts
export type PipelineHooks = {
  onStep?: (message: string) => void;
  confirmVideo: (videoPath: string) => Promise<boolean>;
};

export type PipelineOptions = {
  carOverride?: string;
};

export type PipelineResult = {
  car: string;
  videoUrl: string;
};

export async function runPipeline(
  options: PipelineOptions,
  hooks: PipelineHooks,
): Promise<PipelineResult>;
```

Chứa toàn bộ logic hiện có trong `main()` của
`scripts/run-shorts-pipeline.ts`:

1. Xác định xe: nếu có `carOverride`, validate xe đó tồn tại trong
   `data/cars-master.txt` hoặc queue hiện tại rồi dùng luôn; nếu không, gọi
   `pickNextCar()` như cũ. Xe không hợp lệ → throw lỗi rõ ràng
   (`Không tìm thấy xe "X" trong danh sách`).
2. Điền `prompt-veo3.md`, vòng lặp sinh video → `hooks.onStep("Video đã
   sinh xong")` → `hooks.confirmVideo(videoPath)`. `false` → xoá video, sinh
   lại; `true` → thoát vòng lặp.
3. Sinh metadata (`generateMetadata`) → `hooks.onStep(...)`.
4. Upload YouTube (`uploadToYoutube`) → xoá file local → trả về
   `{ car, videoUrl }`.

`scripts/run-shorts-pipeline.ts` sau khi tách chỉ còn: gọi `runPipeline`
với `onStep` là `console.log`, `confirmVideo` là hàm readline y/n hiện tại
(mở video bằng `open`/`start`/`xdg-open` như cũ), rồi in kết quả.

### `scripts/telegram-bot.ts`

State trong bộ nhớ tiến trình (không cần DB, một pipeline chạy tại một
thời điểm):

```ts
let busy = false;
let currentCar: string | null = null;
let currentStep: string | null = null;
```

Lệnh/handler:

- Mọi update (message/callback) đầu tiên check
  `ctx.chat?.id === Number(TELEGRAM_CHAT_ID)`; không khớp → bỏ qua im lặng
  (không phản hồi, không lộ sự tồn tại của bot).
- `/run [tên xe...]` — nếu `busy` → reply "Đang chạy xe {currentCar}, bước
  {currentStep}, đợi xong đã." Nếu rảnh → set `busy = true`, gọi
  `runPipeline({ carOverride }, hooks)` (không `await` chặn xử lý update
  khác — chạy nền, cập nhật state qua closure).
- `confirmVideo` hook: gửi video bằng `ctx.api.sendVideo` kèm
  `inline_keyboard` 2 nút `Duyệt` (`callback_data: "approve"`) /
  `Làm lại` (`callback_data: "reject"`). Lưu một `resolve` của
  `Promise<boolean>` vào biến closure; `bot.on("callback_query:data")` đọc
  `ctx.callbackQuery.data`, gọi `resolve(data === "approve")`,
  `answerCallbackQuery` để tắt loading trên nút.
- `onStep` hook: cập nhật `currentStep` + gửi tin nhắn text ngắn.
- Kết thúc (thành công) → gửi tin nhắn kèm link YouTube, reset
  `busy = false`, `currentCar = null`, `currentStep = null`.
- Lỗi (catch quanh `runPipeline`) → gửi tin nhắn lỗi rút gọn
  (`err.message`), reset state như trên. Không để lỗi làm crash process.
- `/status` — reply "Rảnh." hoặc "Đang chạy xe {currentCar}, bước
  {currentStep}."

### Env mới (`.env.example`)

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

`TELEGRAM_BOT_TOKEN` lấy từ BotFather. `TELEGRAM_CHAT_ID` là id chat/user
duy nhất được phép ra lệnh (whitelist đơn giản bằng so sánh số).

### `package.json`

Thêm dependency `grammy` và script:

```
"bot": "tsx --env-file=.env scripts/telegram-bot.ts"
```

## Error handling

- Auth: chat/user không khớp `TELEGRAM_CHAT_ID` → im lặng bỏ qua.
- Lỗi trong `runPipeline` (Gemini gen fail, upload fail, v.v.) → catch ở
  `telegram-bot.ts`, báo lỗi vào chat, reset `busy`, process tiếp tục sống
  để nhận `/run` kế tiếp.
- Mất kết nối Telegram tạm thời → `grammy` tự retry long-polling, không
  cần xử lý thêm.
- Video vượt giới hạn 50MB của Telegram Bot API → bắt lỗi riêng từ
  `sendVideo`, báo "video quá lớn để gửi qua Telegram, xem trực tiếp tại
  `<videoPath>` trên máy" thay vì để lỗi chung chung làm crash luồng.
- `carOverride` không khớp danh sách xe → validate trước khi vào vòng sinh
  video, báo lỗi rõ ràng ngay lập tức.

## Testing

- `lib/pipeline.test.ts`: test lõi `runPipeline` bằng cách mock
  `confirmVideo`/`onStep` (không cần Telegram hay Gemini thật, mock luôn
  `generateVideo`/`uploadToYoutube` qua dependency injection hoặc module
  mock nhẹ). Ca cần cover: `confirmVideo` trả `false` → lặp lại sinh video;
  trả `true` → đi tiếp metadata + upload; `carOverride` không hợp lệ →
  throw trước khi sinh video.
- Phần wiring Telegram (`scripts/telegram-bot.ts`) test tay qua bot thật —
  không viết mock cho Telegram Bot API, effort không đáng cho lớp I/O
  mỏng này.

## Ngoài phạm vi (out of scope)

- Hàng đợi nhiều lệnh `/run` chạy nối tiếp (đã chọn: từ chối khi bận, không
  queue).
- Deploy lên VPS/server riêng (đã chọn: chạy trên máy có sẵn Chrome
  profile Gemini).
- `/cancel` để huỷ pipeline giữa chừng (không chọn ở vòng câu hỏi ban đầu).
