// Bounded fixture for the three Capsule competitions, not a process supervisor.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./pc-capsule-child.mjs", import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

export async function runCapsuleCompetition({ mode, database, artifact, timeoutMs = 10000,
  barrierTimeoutMs = timeoutMs, cleanupTimeoutMs = 2000, writerDatabases = {} }) {
  for (const value of [timeoutMs, barrierTimeoutMs, cleanupTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error("competition deadlines must be positive 32-bit integer milliseconds");
  }
  if (!["race", "snapshot-put", "snapshot-insert"].includes(mode)) throw new Error("unsupported Capsule competition");
  if (fs.existsSync(`${artifact}.go`)) throw new Error("competition requires a fresh barrier");
  const writers = [];
  let failure = null;
  const deadline = Date.now() + timeoutMs;
  try {
    for (const tag of ["a", "b"]) {
      if (fs.existsSync(`${artifact}.${tag}.ready`)) throw new Error("competition requires fresh readiness files");
      const proc = spawn(process.execPath, [helper, mode, writerDatabases[tag] ?? database, artifact, tag, String(barrierTimeoutMs)],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const writer = { tag, proc, stdout: "", stderr: "", closed: false, error: null, exitCode: null, signal: null, result: null };
      writers.push(writer);
      proc.stdout.on("data", chunk => { writer.stdout += chunk; });
      proc.stderr.on("data", chunk => { writer.stderr += chunk; });
      // Completion always resolves; observe failure from the moment of spawn,
      // rather than leaving a rejected Promise unhandled during readiness wait.
      writer.done = new Promise(resolve => {
        proc.on("error", error => { writer.error = error; });
        proc.on("close", (code, signal) => {
          writer.closed = true; writer.exitCode = code; writer.signal = signal;
          if (code !== 0 || signal) writer.error ??= new Error(`writer ${tag} exit ${code}, signal ${signal}`);
          else try { writer.result = JSON.parse(writer.stdout); } catch (error) { writer.error ??= error; }
          resolve();
        });
      });
    }
    const assertHealthy = () => {
      const failed = writers.find(writer => writer.error);
      if (failed) throw new Error(`writer ${failed.tag} failed: ${failed.error.message}`);
      if (Date.now() >= deadline) throw new Error("Capsule competition overall deadline exceeded");
    };
    while (!writers.every(writer => fs.existsSync(`${artifact}.${writer.tag}.ready`))) {
      assertHealthy(); await pause();
    }
    assertHealthy();
    if (writers.some(writer => writer.closed)) throw new Error("writer exited before barrier release");
    // Both processes are genuinely ready before the simultaneous competition.
    fs.writeFileSync(`${artifact}.go`, "go");
    while (!writers.every(writer => writer.closed)) { assertHealthy(); await pause(); }
    assertHealthy();
  } catch (error) { failure = error; }
  finally {
    // Cleanup is awaited before the enclosing test can remove its database.
    for (const writer of writers) if (!writer.closed) {
      try { writer.proc.kill("SIGKILL"); } catch (error) { failure ??= error; }
    }
    let timer;
    try {
      await Promise.race([Promise.all(writers.map(writer => writer.done)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Capsule competition cleanup deadline exceeded")), cleanupTimeoutMs);
      })]);
    } catch (error) {
      failure = new Error(`${failure?.message ?? "competition cleanup failed"}; ${error.message}`, { cause: failure ?? error });
      for (const writer of writers) if (!writer.closed) { writer.proc.stdout.destroy(); writer.proc.stderr.destroy(); writer.proc.unref(); }
    } finally { clearTimeout(timer); }
  }
  const outcomes = writers.map(writer => ({ tag: writer.tag, pid: writer.proc.pid, closed: writer.closed,
    exitCode: writer.exitCode, signal: writer.signal, stderr: writer.stderr, stdout: writer.stdout }));
  if (failure) {
    const stderr = outcomes.filter(writer => writer.stderr).map(writer => `writer ${writer.tag} stderr: ${writer.stderr}`).join("\n");
    const error = new Error(`${failure.message}${stderr ? `\n${stderr}` : ""}`, { cause: failure });
    error.writerOutcomes = outcomes;
    throw error;
  }
  return { results: writers.map(writer => writer.result), writerOutcomes: outcomes };
}
