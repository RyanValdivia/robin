// Tests de classifyHeuristic() — módulo puro (classifyHeuristic.ts), sin
// tocar router.ts a propósito: router.ts importa scheduler.ts/conversationLog.ts,
// que abren Redis/Postgres a nivel de módulo — importarlo entero solo para
// probar regexes de texto cuelga los tests esperando conexiones que no
// existen en el entorno de test (ver memory/projects/robin.md, gap #6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHeuristic } from "./classifyHeuristic.ts";

test("saludo simple -> direct", () => {
  assert.equal(classifyHeuristic("hola"), "direct");
  assert.equal(classifyHeuristic("buenos días!"), "direct");
});

test("pregunta de hora/fecha -> direct", () => {
  assert.equal(classifyHeuristic("qué hora es?"), "direct");
});

test("cálculo simple -> direct", () => {
  assert.equal(classifyHeuristic("2 + 2 * 10"), "direct");
});

test("recordatorio con hora exacta -> direct (lo resuelve el router sin LLM)", () => {
  assert.equal(classifyHeuristic("recordame comprar leche a las 8"), "direct");
});

test("recordatorio con fecha ambigua -> agent (Claude calcula la fecha)", () => {
  assert.equal(classifyHeuristic("recordame renovar el dominio 3 días antes de que venza"), "agent");
});

test("pregunta de identidad del propio bot -> agent, no knowledge", () => {
  assert.equal(classifyHeuristic("qué eres?"), "agent");
  assert.equal(classifyHeuristic("qué podés hacer?"), "agent");
});

test("pedido de acción (github/bash/browser) -> agent", () => {
  assert.equal(classifyHeuristic("revisá mis repos de github"), "agent");
  assert.equal(classifyHeuristic("corré un comando en el servidor"), "agent");
});

test("pregunta sobre memoria del usuario -> knowledge", () => {
  assert.equal(classifyHeuristic("te acordás de mi proyecto favorito?"), "knowledge");
});

test("texto ambiguo sin match de ningún patrón -> null (cae al LLM barato en classify())", () => {
  assert.equal(classifyHeuristic("me mudé a Lima la semana pasada"), null);
});
