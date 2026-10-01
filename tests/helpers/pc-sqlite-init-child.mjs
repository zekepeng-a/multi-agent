import fs from "node:fs";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";

const [file, ready, timeout] = process.argv.slice(2);
fs.writeFileSync(ready, "opening");
const began = Date.now();
try {
  const store = timeout === "default" ? new SqliteStore(file) : new SqliteStore(file, { busyTimeoutMs: Number(timeout) });
  store.close();
  console.log(JSON.stringify({ success: true, elapsedMs: Date.now() - began }));
} catch (error) {
  console.log(JSON.stringify({ success: false, elapsedMs: Date.now() - began, message: error.message,
    code: error.code, errcode: error.errcode }));
}
