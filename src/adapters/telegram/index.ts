// Telegram adapter — thin: normaliza mensajes, valida owner, delega al brain.
// Sin lógica de LLM acá (ver plan, arquitectura: Event Gateway).
import { Bot } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "../../config.ts";
import { isOwner, getOwnerUserId } from "../../brain/auth.ts";
import { createBrainSession, type BrainSession } from "../../brain/session.ts";
import { routeMessage } from "../../brain/router.ts";
import { registerOutboundSender, startSchedulerWorker } from "../../brain/scheduler.ts";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("[telegram] TELEGRAM_BOT_TOKEN no seteado en .env — no puedo arrancar.");
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Una sesión (contexto de conversación) por chat — el modelo de embeddings y
// las conexiones a MCP se comparten (singletons a nivel proceso), pero cada
// chat mantiene su propio hilo de conversación con Claude.
const sessions = new Map<number, BrainSession>();

function sessionFor(chatId: number): BrainSession {
  let s = sessions.get(chatId);
  if (!s) {
    s = createBrainSession();
    sessions.set(chatId, s);
  }
  return s;
}

const TELEGRAM_MAX = 4000; // margen bajo el límite real de 4096

function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > TELEGRAM_MAX) {
    let cut = rest.lastIndexOf("\n", TELEGRAM_MAX);
    if (cut < TELEGRAM_MAX * 0.5) cut = TELEGRAM_MAX;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// /start es el mensaje automático que manda Telegram al abrir un chat nuevo con
// el bot — respuesta fija, no lo mandamos al LLM (categoría DIRECT, sin costo).
bot.command("start", async (ctx) => {
  const fromId = String(ctx.from?.id ?? "");
  if (!(await isOwner("telegram", fromId))) return;
  await ctx.reply("Hola, soy Robin. Contame qué necesitás.");
});

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const fromId = String(ctx.from?.id ?? "");

  if (!(await isOwner("telegram", fromId))) {
    // Silencio deliberado: no confirmamos ni negamos que el bot existe/funciona
    // a IDs no autorizados. Ver plan, sección Seguridad.
    console.log(`[telegram] mensaje ignorado de ID no autorizado: ${fromId}`);
    return;
  }

  await ctx.replyWithChatAction("typing");

  try {
    // El router decide DIRECT/KNOWLEDGE/AGENT (ver brain/router.ts) — la sesión
    // de Claude (sessionFor) solo se crea si el mensaje termina yendo a AGENT,
    // así DIRECT/KNOWLEDGE no gastan cuota de Claude ni levantan el proceso.
    // El ctx (userId/channel/externalId) es lo que necesita un recordatorio
    // DIRECT (V5) para saber a quién avisar cuando dispare.
    const userId = await getOwnerUserId(); // solo llega acá si isOwner ya dio true
    const reply = await routeMessage(
      ctx.message.text,
      () => sessionFor(chatId).send(ctx.message.text),
      userId ? { userId, channel: "telegram", externalId: fromId } : undefined,
    );
    for (const chunk of splitForTelegram(reply || "(sin respuesta)")) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    console.error("[telegram] error procesando mensaje:", err);
    await ctx.reply("Uh, tuve un error interno procesando eso. Ver logs del server.");
  }
});

bot.catch((err) => {
  console.error("[telegram] error no manejado:", err);
});

// El scheduler (V5) empuja acá cuando dispara un recordatorio — no depende de
// Claude ni de que haya una sesión de chat abierta en ese momento.
registerOutboundSender(async (channel, externalId, text) => {
  if (channel !== "telegram") {
    console.warn(`[telegram] outbound sender ignoró canal desconocido: ${channel}`);
    return;
  }
  await bot.api.sendMessage(Number(externalId), text);
});
startSchedulerWorker();

console.log("[telegram] arrancando (long polling)...");
bot.start({
  onStart: (info) => console.log(`[telegram] listo — @${info.username}`),
});
