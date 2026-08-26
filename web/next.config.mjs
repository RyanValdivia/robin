import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `output: "standalone"` — imagen de producción liviana (Dockerfile copia
// solo .next/standalone, no node_modules completo). `outputFileTracingRoot`
// apunta a la raíz real del repo (hay dos lockfiles — el de acá y el de la
// raíz — porque las rutas de brain/ viven fuera de web/, ver tsconfig.json
// paths). `serverExternalPackages` evita que webpack intente bundlear
// paquetes nativos/de proceso hijo de brain/ (pg, ioredis, el Agent SDK) —
// corren tal cual en Node, sin bundlear.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: [
    "pg",
    "ioredis",
    "bullmq",
    "web-push",
    "@anthropic-ai/claude-agent-sdk",
    "@huggingface/transformers",
  ],
};

export default nextConfig;
