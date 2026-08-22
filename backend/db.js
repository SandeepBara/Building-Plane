// Minimal file-based "database" so the starter project runs with zero setup.
// Swap this out for PostgreSQL (pg) or MongoDB (mongoose) once you're past prototyping —
// keep the same readDB()/writeDB() shape so the routes don't need to change much.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "data", "db.json");

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], projects: [] }, null, 2));
  }
}

export function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

export function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
