import { Bot, InlineKeyboard, InputFile } from "grammy";
import { runPipeline } from "../lib/pipeline.ts";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = Number(process.env.TELEGRAM_CHAT_ID);
if (!token) throw new Error("Thiếu TELEGRAM_BOT_TOKEN trong .env");
if (!chatId) throw new Error("Thiếu hoặc sai TELEGRAM_CHAT_ID trong .env");

const bot = new Bot(token);

let busy = false;
let currentCar: string | null = null;
let currentStep: string | null = null;
let pendingConfirm: ((approved: boolean) => void) | null = null;

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== chatId) return;
  await next();
});

bot.command("status", async (ctx) => {
  if (!busy) {
    await ctx.reply("Rảnh.");
    return;
  }
  await ctx.reply(`Đang tạo video cho mẫu xe ${currentCar}, đang thực hiện bước: ${currentStep}.`);
});

bot.command("run", async (ctx) => {
  if (busy) {
    await ctx.reply(`Đang tạo video cho mẫu xe ${currentCar}, đang thực hiện bước: ${currentStep}. Đợi xong đã.`);
    return;
  }

  const carOverride = ctx.match?.toString().trim() || undefined;
  busy = true;
  currentCar = carOverride ?? "(đang chọn...)";
  currentStep = "Bắt đầu";

  runPipeline(
    { carOverride },
    {
      onStep: (message) => {
        currentStep = message;
        if (message.startsWith("Xe: ")) currentCar = message.slice("Xe: ".length);
        ctx.reply(message).catch(() => { });
      },
      confirmVideo: (videoPath) =>
        new Promise<boolean>((resolve) => {
          pendingConfirm = resolve;
          const keyboard = new InlineKeyboard().text("Duyệt", "approve").text("Làm lại", "reject");
          ctx
            .replyWithVideo(new InputFile(videoPath), { reply_markup: keyboard })
            .catch(async (err) => {
              await ctx
                .reply(
                  `Video quá lớn để gửi qua Telegram, xem trực tiếp tại ${videoPath} trên máy. ` +
                  `Gõ /approve hoặc /reject để tiếp tục. (Lỗi: ${(err as Error).message})`,
                )
                .catch(() => { });
            });
        }),
    },
  )
    .catch(async (err) => {
      await ctx.reply(`Lỗi: ${(err as Error).message}`).catch(() => { });
    })
    .finally(() => {
      busy = false;
      currentCar = null;
      currentStep = null;
      pendingConfirm = null;
    });
});

bot.command("approve", async (ctx) => {
  if (!pendingConfirm) return;
  pendingConfirm(true);
  pendingConfirm = null;
});

bot.command("reject", async (ctx) => {
  if (!pendingConfirm) return;
  pendingConfirm(false);
  pendingConfirm = null;
});

bot.on("callback_query:data", async (ctx) => {
  const approved = ctx.callbackQuery.data === "approve";
  await ctx.answerCallbackQuery();
  pendingConfirm?.(approved);
  pendingConfirm = null;
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start();
console.log("Telegram bot đang chạy, chờ lệnh /run...");
