import * as readline from "node:readline";
import { createBrainSession, type BrainSession } from "./brain/session.ts";
import { routeMessage } from "./brain/router.ts";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "vos> ",
  });

  // Lazy: solo se crea si el router manda algo a AGENT (ver brain/router.ts).
  let session: BrainSession | null = null;
  function agentSession(): BrainSession {
    if (!session) session = createBrainSession();
    return session;
  }
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  console.log("Robin — CLI local. Escribí 'salir' para terminar.\n");
  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!closed) rl.prompt();
      continue;
    }
    if (trimmed.toLowerCase() === "salir" || trimmed.toLowerCase() === "exit") {
      break;
    }

    const reply = await routeMessage(trimmed, () => agentSession().send(trimmed));
    if (reply) console.log(`\nRobin> ${reply}\n`);
    if (!closed) rl.prompt();
  }

  if (!closed) rl.close();
  console.log("\nChau.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
