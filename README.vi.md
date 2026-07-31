# yt-flow

[English](README.md)

Pipeline tự động: chọn xe, tạo video ASMR về xe đó, preview + xác nhận, tạo metadata YouTube, upload YouTube.

## Cài đặt

1. Copy `.env.example` thành `.env`, điền các key bên dưới.
2. `npm install`, sau đó `npx playwright install chromium`.
3. Login Gemini 1 lần: `npm run gemini:login` (mở cửa sổ Chrome thật, login tay, Enter ở terminal khi xong — session lưu tại `.gemini-profile/`, không commit vào git).

### Lấy các key trong `.env`

**`GEMINI_API_KEY`** — chỉ dùng để tạo metadata (title/description/tags), không dùng cho video:
1. Vào [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Bấm "Create API key", chọn hoặc tạo project Google Cloud.
3. Copy key vào `.env`.

**`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`** — OAuth client để upload video:
1. Vào [Google Cloud Console](https://console.cloud.google.com/), chọn/tạo project, bật **YouTube Data API v3** (APIs & Services → Library).
2. APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type **Desktop app**.
3. Copy Client ID và Client Secret vào `.env`.
4. Nếu được yêu cầu, cấu hình OAuth consent screen trước (chọn External, chế độ testing dùng được cho cá nhân — thêm chính tài khoản Google của bạn vào test user).

**`YOUTUBE_REFRESH_TOKEN`** — lấy 1 lần qua OAuth flow thủ công, ví dụ dùng [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
1. Bấm icon bánh răng (góc trên phải) → tick "Use your own OAuth credentials" → dán `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`.
2. Ở ô nhập scope, nhập cả 2 scope cách nhau bằng dấu cách: `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly` (hoặc chỉ cần `https://www.googleapis.com/auth/youtube` để có toàn quyền), bấm **Authorize APIs**, đăng nhập bằng tài khoản Google sở hữu kênh YouTube đích.
3. Bấm **Exchange authorization code for tokens** — copy giá trị **Refresh token** vào `.env`.

## Chạy

`npm run pipeline`:

1. Lấy xe tiếp theo từ `data/cars-queue.json` (tự nạp lại từ `data/cars.json` khi hết).
2. Điền xe vào `prompt-veo3.md`, tạo video bằng cách điều khiển `gemini.google.com` qua Playwright (`lib/gemini-browser.ts`) — không cần Veo3 API key. Lưu tại `output/veo-<timestamp>.mp4`.
3. Mở video để bạn xem trước. Xác nhận ở terminal: `y` tiếp tục upload, `n` xoá và tạo lại video.
4. Tạo title/description/tags từ `prompt-create-info-video.md` qua Gemini API.
5. Upload lên YouTube (privacy theo `YOUTUBE_PRIVACY_STATUS`, mặc định private) và xoá file video local.

## Điều khiển từ xa qua Telegram

`npm run bot` chạy 1 bot nền, cho phép kích hoạt và duyệt video ngay từ
điện thoại — không cần đụng terminal sau khi đã khởi động bot.

1. Tạo bot qua [@BotFather](https://t.me/BotFather), copy token vào
   `TELEGRAM_BOT_TOKEN` trong `.env`.
2. Gửi 1 tin nhắn bất kỳ cho bot, sau đó mở
   `https://api.telegram.org/bot<token>/getUpdates` trên trình duyệt, copy
   `message.chat.id` vào `TELEGRAM_CHAT_ID` trong `.env`. Chỉ chat này được
   ra lệnh — chat khác bị bỏ qua hoàn toàn (không phản hồi).
3. `npm run bot`.
4. Từ Telegram:
   - `/run` — lấy xe tiếp theo trong queue, chạy toàn bộ pipeline.
   - `/run Toyota Supra MK4` — chạy pipeline cho 1 xe cụ thể (phải khớp 1
     dòng trong `data/cars.json`).
   - `/status` — xem có đang chạy không, đang ở bước nào.
   - Khi video sinh xong, bạn nhận được video kèm nút **Duyệt** / **Làm
     lại**. Nếu video quá lớn để gửi qua Telegram (>50MB), mở trực tiếp
     đường dẫn được in ra trên máy rồi gõ `/approve` hoặc `/reject`.

Giữ bot chạy nền bằng [pm2](https://pm2.keymetrics.io/) (chạy giống nhau
trên macOS và Windows):

```bash
npm install -g pm2
pm2 start npm --name yt-flow-bot -- run bot
pm2 save
```

## Giao diện web

`npm run web` chạy 1 dashboard local tại `http://127.0.0.1:3000` (đổi port bằng `WEB_PORT`) để setup key, chọn xe, generate, preview và duyệt ngay trên trình duyệt thay vì terminal hoặc Telegram.

1. `npm run web`.
2. Mở `http://127.0.0.1:3000`.
3. Điền key ở phần Setup rồi lưu (giá trị cũ hiện dạng che bớt; để trống ô nào nghĩa là giữ nguyên giá trị đó).
4. Chọn 1 xe cụ thể từ dropdown (tuỳ chọn — để trống dùng thứ tự queue mặc định) rồi bấm **Generate**.
5. Video sinh xong, preview ngay trên trang, bấm **Duyệt** hoặc **Từ chối** (tạo lại).
6. Sửa title/description/tags nếu cần, bấm **Upload** để đăng lên YouTube.

Dashboard chỉ bind `127.0.0.1`, không có đăng nhập — chỉ dành cho dùng local 1 người. Chỉ nên chạy 1 trong 3 cách (web dashboard / `npm run bot` / `npm run pipeline`) tại 1 thời điểm — chạy nhiều cái cùng lúc có thể tranh nhau `data/cars-queue.json`.

## Nếu Google đổi giao diện Gemini

Selector trong `lib/gemini-browser.ts` bám theo DOM thật, có thể bị vỡ khi Google đổi UI. Công cụ debug:

- `npx tsx --env-file=.env scripts/gemini-test-video.ts "test prompt"` — chạy riêng flow gen video.
- `npx tsx --env-file=.env scripts/gemini-inspect.ts [url]` — dump cây accessibility của 1 trang Gemini.
- `npx tsx --env-file=.env scripts/gemini-inspect-result.ts "prompt"` — submit prompt rồi dump DOM mỗi 60s tới khi video xong.
- `npx tsx --env-file=.env scripts/gemini-inspect-ratio.ts` — dump menu chọn tỷ lệ khung hình.

## File khác

- `next-car.sh` — helper độc lập, lấy 1 xe từ `cars-queue.txt`/`cars-master.txt`, điền cả 2 prompt template vào `output/<slug>-<timestamp>/`, dùng thủ công ngoài pipeline tự động.
