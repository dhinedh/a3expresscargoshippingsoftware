import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
// Resolve SQLite DB path: prioritize local tariff.db inside backend-node
const localDbPath = path.resolve(process.cwd(), './tariff.db');
const fallbackDbPath = path.resolve(process.cwd(), '../backend/tariff.db');
const defaultDbPath = fs.existsSync(localDbPath) ? localDbPath : fallbackDbPath;
const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : defaultDbPath;
if (!fs.existsSync(dbPath)) {
    console.warn(`[SQLite] Database file not found at ${dbPath}, attempting fallback...`);
}
export const sqliteDb = new DatabaseSync(dbPath);
console.log(`[SQLite] Connected successfully to: ${dbPath}`);
export const db = {
    all(sql, ...params) {
        const stmt = sqliteDb.prepare(sql);
        return stmt.all(...params);
    },
    get(sql, ...params) {
        const stmt = sqliteDb.prepare(sql);
        const res = stmt.get(...params);
        return (res || null);
    },
    run(sql, ...params) {
        const stmt = sqliteDb.prepare(sql);
        const result = stmt.run(...params);
        return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
        };
    },
    exec(sql) {
        sqliteDb.exec(sql);
    }
};
