import { type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function localDockerEnvironment(socketPath: unknown, inherited: NodeJS.ProcessEnv) {
  if (typeof socketPath !== "string" || !socketPath.startsWith("/")) {
    throw new Error("Preview requires a resolved local Unix socket Docker runtime");
  }
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter(
        ([key]) =>
          ![
            "DOCKER_HOST",
            "DOCKER_CONTEXT",
            "DOCKER_TLS",
            "DOCKER_TLS_VERIFY",
            "DOCKER_CERT_PATH",
          ].includes(key),
      ),
    ),
    DOCKER_HOST: `unix://${socketPath}`,
  };
}

export function verifyDaemonIds(actual: unknown, cli: unknown) {
  if (typeof actual !== "string" || !actual || typeof cli !== "string" || !cli) {
    throw new Error("Could not establish Docker daemon identity");
  }
  if (actual !== cli) throw new Error("Docker daemon mismatch; refusing preview provisioning");
}

export async function bounded<T>(
  name: string,
  work: () => Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (ms <= 0) throw new Error(`${name}: cleanup deadline exceeded`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
        abort = () => reject(signal!.reason);
        signal?.addEventListener("abort", abort, { once: true });
      }),
      work(),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export class CleanupBudget {
  errors: string[] = [];
  deadline: number;
  stepMs: number;
  constructor(totalMs: number, stepMs: number) {
    this.deadline = Date.now() + totalMs;
    this.stepMs = stepMs;
  }
  async guard(name: string, work: () => Promise<unknown>) {
    try {
      await bounded(name, work, Math.min(this.stepMs, this.deadline - Date.now()));
      return true;
    } catch (error) {
      this.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

export class PendingOperations {
  private active = new Map<Promise<unknown>, string>();
  track<T>(label: string, work: () => Promise<T>): Promise<T> {
    const promise = work();
    this.active.set(promise, label);
    void promise.then(
      () => this.active.delete(promise),
      () => this.active.delete(promise),
    );
    return promise;
  }
  labels() {
    return [...this.active.values()];
  }
  async settle() {
    await Promise.allSettled(this.active.keys());
  }
}

export function previewEnvironment(inherited: NodeJS.ProcessEnv, configPath: string) {
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter(([key]) => !key.startsWith("HEADPLANE_")),
    ),
    NODE_ENV: "development",
    HEADPLANE_CONFIG_PATH: configPath,
  };
}

export function processGroupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function stopProcess(child: ChildProcess, graceMs = 10_000) {
  if (!child.pid) return;
  const pid = child.pid;
  const signal = (value: NodeJS.Signals) => {
    try {
      process.kill(-pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  // The detached process group outlives pnpm. Its leader's exit is not cleanup.
  signal("SIGTERM");
  const graceful = Date.now() + graceMs;
  while (processGroupExists(pid) && Date.now() < graceful) await delay(20);
  if (!processGroupExists(pid)) return;
  signal("SIGKILL");
  const deadline = Date.now() + 2000;
  while (processGroupExists(pid) && Date.now() < deadline) await delay(20);
  if (processGroupExists(pid)) throw new Error(`Process group ${pid} survived SIGKILL`);
}
