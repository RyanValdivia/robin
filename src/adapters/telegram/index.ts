// Telegram adapter — thin: normaliza mensajes, valida owner, delega al brain.
// Sin lógica de LLM acá (ver plan, arquitectura: Event Gateway).
import { Bot, InputFile, type Context } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "../../config.ts";
import { isOwner, getOwnerUserId } from "../../brain/auth.ts";
import { createBrainSession, type BrainSession } from "../../brain/session.ts";
import { routeMessage, type RouteContext } from "../../brain/router.ts";
import { registerOutboundSender, startSchedulerWorker } from "../../brain/scheduler.ts";
import { startProactiveWorker, registerProactiveJobs } from "../../brain/proactive.ts";
import { sttAvailable, transcribeAudio } from "../../brain/stt.ts";
import { ttsAvailable, synthesizeSpeech } from "../../brain/tts.ts";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("[telegram] TELEGRAM_BOT_TOKEN no seteado en .env — no puedo arrancar.");
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Una sesión (contexto de conversación) por chat — el modelo de embeddings y
// las conexiones a MCP se comparten (singletons a nivel proceso), pero cada
// chat mantiene su propio hilo de conversación con Claude.
const sessions = new Map<number, BrainSession>();

function sessionFor(chatId: number, ctx?: RouteContext): BrainSession {
  let s = sessions.get(chatId);
  if (!s) {
    s = createBrainSession(ctx); // ctx solo importa en la creación (liga tool_audit_log a la conversación)
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

// Compartido por texto y voz (transcripta) — el router no distingue de dónde
// vino el texto. `prefix` es para mostrar la transcripción antes de la
// respuesta cuando el mensaje vino de un audio. `speak`: además de texto,
// mandar la respuesta como nota de voz (TTS, V6) — solo tiene sentido cuando
// la entrada también fue voz, no forzamos audio en una conversación tipeada.
async function handleIncomingText(
  ctx: Context,
  chatId: number,
  fromId: string,
  text: string,
  opts: { prefix?: string; speak?: boolean } = {},
): Promise<void> {
  const { prefix = "", speak = false } = opts;
  await ctx.replyWithChatAction("typing");
  try {
    // El router decide DIRECT/KNOWLEDGE/AGENT (ver brain/router.ts) — la sesión
    // de Claude (sessionFor) solo se crea si el mensaje termina yendo a AGENT,
    // así DIRECT/KNOWLEDGE no gastan cuota de Claude ni levantan el proceso.
    // El ctx (userId/channel/externalId) es lo que necesita un recordatorio
    // DIRECT (V5) para saber a quién avisar cuando dispare.
    const userId = await getOwnerUserId(); // solo llega acá si isOwner ya dio true
    const routeCtx: RouteContext | undefined = userId ? { userId, channel: "telegram", externalId: fromId } : undefined;
    const reply = await routeMessage(text, () => sessionFor(chatId, routeCtx).send(text), routeCtx);
    const full = prefix + (reply || "(sin respuesta)");
    for (const chunk of splitForTelegram(full)) {
      await ctx.reply(chunk);
    }
    if (speak && reply && ttsAvailable()) {
      try {
        const audio = await synthesizeSpeech(reply);
        await ctx.replyWithVoice(new InputFile(audio));
      } catch (err) {
        // No molesta al usuario con un error de un bonus que ni pidió — ya
        // tiene la respuesta en texto arriba.
        console.error("[telegram] error generando nota de voz:", err);
      }
    }
  } catch (err) {
    console.error("[telegram] error procesando mensaje:", err);
    await ctx.reply("Uh, tuve un error interno procesando eso. Ver logs del server.");
  }
}

bot.on("message:text", async (ctx) => {
  const fromId = String(ctx.from?.id ?? "");

  if (!(await isOwner("telegram", fromId))) {
    // Silencio deliberado: no confirmamos ni negamos que el bot existe/funciona
    // a IDs no autorizados. Ver plan, sección Seguridad.
    console.log(`[telegram] mensaje ignorado de ID no autorizado: ${fromId}`);
    return;
  }

  await handleIncomingText(ctx, ctx.chat.id, fromId, ctx.message.text);
});

// Notas de voz (V6, ver plan) — se transcriben con el servicio whisper/ y de
// ahí en más siguen exactamente el mismo camino que un mensaje de texto.
bot.on("message:voice", async (ctx) => {
  const fromId = String(ctx.from?.id ?? "");
  if (!(await isOwner("telegram", fromId))) {
    console.log(`[telegram] audio ignorado de ID no autorizado: ${fromId}`);
    return;
  }
  if (!sttAvailable()) {
    await ctx.reply("Todavía no tengo la transcripción de voz configurada.");
    return;
  }

  await ctx.replyWithChatAction("typing");
  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`descarga del audio falló: ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());
    const text = await transcribeAudio(audio);
    if (!text) {
      await ctx.reply("No entendí el audio, ¿lo repetís?");
      return;
    }
    await handleIncomingText(ctx, ctx.chat.id, fromId, text, { prefix: `🎙️ "${text}"\n\n`, speak: true });
  } catch (err) {
    console.error("[telegram] error transcribiendo audio:", err);
    await ctx.reply("No pude transcribir el audio. Ver logs del server.");
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

// Resumen proactivo diario/semanal (ver brain/proactive.ts) — mismo proceso,
// reusa el outbound sender de arriba.
startProactiveWorker();
await registerProactiveJobs();

console.log("[telegram] arrancando (long polling)...");
bot.start({
  onStart: (info) => console.log(`[telegram] listo — @${info.username}`),
});
