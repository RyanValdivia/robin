import pg from "pg";
import { DATABASE_URL } from "./config.ts";

export const pool = new pg.Pool({ connectionString: DATABASE_URL });
