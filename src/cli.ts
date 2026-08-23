import * as readline from "node:readline";
import { createBrainSession } from "./brain/session.ts";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "vos> ",
  });

  const session = createBrainSession();
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  console.log("JARVIS — CLI local. Escribí 'salir' para terminar.\n");
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

    const reply = await session.send(trimmed);
    if (reply) console.log(`\nJARVIS> ${reply}\n`);
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
