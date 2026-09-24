import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

await migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("Migrations applied.");
await pool.end();
