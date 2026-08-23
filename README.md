# JARVIS

Asistente personal con Claude. Arquitectura completa en
`C:\Users\LENOVO\.claude\plans\quisiera-hacer-algo-asi-squishy-kurzweil.md`.

## Estado: V0 — CLI local

CLI de chat que usa Claude Agent SDK, con memoria persistente en `memory/` (vault
markdown estilo Obsidian). Sin Postgres/Redis/Docker todavía — eso llega en V1.

```
npm install
npm run chat
```

Requiere estar logueado con Claude Code en esta máquina (`claude login` /
`claude setup-token`) — el CLI hereda esa autenticación automáticamente, sin API key.

Escribí `salir` para terminar.

## Estructura

- `src/cli.ts` — loop de chat, arma el system prompt desde `memory/MEMORY.md`.
- `memory/` — vault de conocimiento (fuente de verdad). Editable a mano (Obsidian
  compatible) o por JARVIS mismo cuando le pedís que recuerde algo.
