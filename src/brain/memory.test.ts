// Tests de los helpers puros de memory.ts (sin Postgres/embeddings — esos
// quedan fuera a propósito, necesitarían mocks pesados para poco beneficio).
// labelForCategory() sí toca el filesystem real (memory/.categories.json del
// propio repo) — es determinístico porque ese archivo vive en git, no un mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWikilinks, exactScore, labelForCategory } from "./memory.ts";

test("parseWikilinks extrae nombres sin duplicados", () => {
  const body = "Ver [[robin]] y también [[robin-vps-ssh]]. De nuevo [[robin]].";
  assert.deepEqual(parseWikilinks(body), ["robin", "robin-vps-ssh"]);
});

test("parseWikilinks ignora alias (|) y anclas (#) del wikilink", () => {
  assert.deepEqual(parseWikilinks("[[nota|texto mostrado]] y [[otra#sección]]"), ["nota", "otra"]);
});

test("parseWikilinks vacío si no hay links", () => {
  assert.deepEqual(parseWikilinks("texto sin links"), []);
});

test("exactScore: más términos matcheados -> score más alto, siempre >= 1", () => {
  const terms = ["robin", "vps", "ssh"];
  const unScore = exactScore("solo menciona robin acá", terms);
  const tresScore = exactScore("robin vps ssh todo junto", terms);
  assert.ok(unScore >= 1);
  assert.ok(tresScore > unScore);
});

test("labelForCategory: categorías conocidas vienen de memory/.categories.json", () => {
  assert.equal(labelForCategory("user"), "User");
  assert.equal(labelForCategory("projects"), "Projects");
});

test("labelForCategory: categoría desconocida cae a capitalizar (gap #6 — editable sin tocar código)", () => {
  assert.equal(labelForCategory("salud"), "Salud");
});
