// Zona horaria fija del usuario (Lima, UTC-5 sin DST) — un solo lugar para
// "hora actual en ISO", usado tanto por el system prompt (una vez, al
// arrancar la sesión) como por session.ts (una vez POR MENSAJE — ver ahí por
// qué esto último es lo que de verdad importa).
export function limaNowISO(): string {
  const now = new Date();
  return now.toLocaleString("sv-SE", { timeZone: "America/Lima" }).replace(" ", "T") + "-05:00";
}
