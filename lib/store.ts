import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Scans are kept on Render's persistent disk (/var/data) when one is attached, so they survive redeploys.
// The repo's .cache holds the seeded demo creators and is the fallback when no disk is mounted.
const DISK = "/var/data/scans";
const SEED = path.join(process.cwd(), ".cache");
const dir = () => (existsSync("/var/data") ? DISK : SEED);

export async function readScan(handle: string) {
  for (const d of [dir(), SEED]) {
    try {
      return JSON.parse(await readFile(path.join(d, `${handle}.json`), "utf8"));
    } catch {}
  }
  return null;
}

export async function writeScan<T extends object>(handle: string, data: T): Promise<T & { scannedAt: string }> {
  const d = dir();
  await mkdir(d, { recursive: true });
  const stamped = { ...data, scannedAt: new Date().toISOString() };
  await writeFile(path.join(d, `${handle}.json`), JSON.stringify(stamped));
  return stamped;
}
