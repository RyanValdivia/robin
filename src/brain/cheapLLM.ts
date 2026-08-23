// LLM barato (ramas DIRECT/KNOWLEDGE del router, ver plan) — $0, no toca la
// cuota de Claude. Interfaz mínima (chatComplete), implementación intercambiable
// por CHEAP_LLM_PROVIDER igual que LLM_PROVIDER en config.ts.
import { CHEAP_LLM_PROVIDER, GROQ_API_KEY, GROQ_MODEL } from "../config.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function cheapLlmAvailable(): boolean {
  return CHEAP_LLM_PROVIDER === "groq" && Boolean(GROQ_API_KEY);
}

/** Una llamada simple, sin streaming ni tools — para clasificar o sintetizar una respuesta corta. */
export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  if (!cheapLlmAvailable()) {
    throw new Error("Cheap LLM no configurado (falta GROQ_API_KEY).");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq respondió ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}
