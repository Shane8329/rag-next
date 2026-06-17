import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function loadDotEnv(startDir = process.cwd()): void {
  const envPath = findDotEnvPath(startDir);

  if (!envPath) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    process.env[key] = value;
  }
}

function findDotEnvPath(startDir: string): string | undefined {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = resolve(currentDir, ".env");

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}
