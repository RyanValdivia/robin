// MCP servers externos (AGENT). GitHub y Playwright reusados, no reinventados
// (ver plan, sección Herramientas).
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export function buildMcpServers(): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {
    playwright: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--isolated"],
    },
  };

  const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (githubToken) {
    servers.github = {
      type: "stdio",
      // Binario copiado a la imagen en el Dockerfile (multi-stage desde
      // ghcr.io/github/github-mcp-server) — así el contenedor de robin no
      // necesita acceso al socket de Docker del host para levantarlo.
      // En dev local (sin ese multi-stage) cae al `docker run` de siempre.
      command: process.env.GITHUB_MCP_BIN ?? "docker",
      args: process.env.GITHUB_MCP_BIN
        ? ["stdio"]
        : ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  } else {
    console.log(
      "[robin] GITHUB_PERSONAL_ACCESS_TOKEN no seteado en .env — tools de GitHub deshabilitadas por ahora.",
    );
  }

  return servers;
}
