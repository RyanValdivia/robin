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
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server",
      ],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  } else {
    console.log(
      "[jarvis] GITHUB_PERSONAL_ACCESS_TOKEN no seteado en .env — tools de GitHub deshabilitadas por ahora.",
    );
  }

  return servers;
}
