import { reindexAll } from "../brain/memory.ts";
import { pool } from "../db.ts";

const n = await reindexAll();
console.log(`Reindexadas ${n} notas.`);
await pool.end();
