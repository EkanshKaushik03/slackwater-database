import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, withPublishedPrecision } from "@slackwater/stations";
import {
  buildStation,
  constantsUrl,
  gaugeUrl,
  INDEX_URL,
  parseHarmonics,
  parseInventory,
  type Gauge,
} from "./jhod.ts";

export const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
type File = { path: string; url: string; sha256: string };
type Manifest = { retrievedAt: string; files: File[] };
const digest = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");

function hasHarmonics(gauge: Gauge, html: string) {
  if (
    /<title>(.*?)<\/title>/s.exec(html)?.[1] !==
    `Realtime tidal data at ${gauge.name}`
  )
    throw new Error(`${gauge.id}: missing or mismatched gauge page`);
  return html.includes(`hc_e.php?s=${gauge.id}`);
}

export async function stationIds(dir: string) {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function checkWithdrawals(
  previous: string[],
  next: Set<string>,
  withdrawn: string[],
) {
  if (withdrawn.some((id) => !/^\d{4}$/.test(id)))
    throw new Error("Withdrawal IDs must be four digits");
  const missing = previous.filter(
    (id) => !next.has(id) && !withdrawn.includes(id),
  );
  if (missing.length)
    throw new Error(
      `Unexpected JHOD withdrawal: ${missing.join(", ")}. Review the source change, then pass ${missing.map((id) => `--withdraw=${id}`).join(" ")}.`,
    );
}

export async function verifySnapshot(dir = FIXTURES_DIR) {
  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const contents = new Map<string, string>();
  for (const file of manifest.files) {
    if (
      !/^(?:index|explanation|terms|\d{4}-(?:gauge|constants))\.html$/.test(
        file.path,
      ) ||
      contents.has(file.path)
    )
      throw new Error(`Invalid snapshot path: ${file.path}`);
    const bytes = await readFile(join(dir, file.path));
    if (digest(bytes) !== file.sha256)
      throw new Error(`Checksum mismatch: ${file.path}`);
    contents.set(file.path, bytes.toString("utf8"));
  }
  const required = (path: string) => {
    const body = contents.get(path);
    if (body === undefined) throw new Error(`Missing snapshot page: ${path}`);
    return body;
  };
  required("explanation.html");
  required("terms.html");
  const gauges = parseInventory(required("index.html"));
  const harmonics = gauges.flatMap((gauge) => {
    const html = required(`${gauge.id}-gauge.html`);
    return hasHarmonics(gauge, html)
      ? [parseHarmonics(required(`${gauge.id}-constants.html`), gauge)]
      : [];
  });
  if (!harmonics.length)
    throw new Error("No JHOD harmonic stations in snapshot");
  return { harmonics, contents };
}

async function withOutputLock<T>(
  dir: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(dir), { recursive: true });
  const lock = `${resolve(dir)}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `JHOD output is locked: ${lock}. Remove the lock directory only after confirming no importer or refresh is running.`,
      );
    throw error;
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function importSnapshot(
  dir = FIXTURES_DIR,
  dataDir = DATA_DIR,
  withdrawn: string[] = [],
) {
  const out = join(dataDir, "jhod");
  return withOutputLock(out, async () => {
    const { harmonics } = await verifySnapshot(dir);
    const previous = await stationIds(out);
    const keep = new Set(harmonics.map((h) => h.id));
    checkWithdrawals(previous, keep, withdrawn);
    // Build every record before replacing anything, so a bad page preserves the current data.
    const records = harmonics.map((h) => ({
      id: h.id,
      data: withPublishedPrecision("jhod", buildStation(h)),
    }));
    await mkdir(out, { recursive: true });
    for (const record of records)
      await writeFile(
        join(out, `${record.id}.json`),
        JSON.stringify(record.data, null, 2) + "\n",
      );
    // Only the initial inventory passed the explicit withdrawal check.
    for (const id of previous)
      if (!keep.has(id)) await rm(join(out, `${id}.json`));
    return records.length;
  });
}

export async function refreshSnapshot(
  dir = FIXTURES_DIR,
  request = globalThis.fetch,
  withdrawn: string[] = [],
) {
  return withOutputLock(dir, async () => {
    const stage = await mkdtemp(join(dirname(dir), ".jhod-refresh-"));
    const files: File[] = [];
    const get = async (path: string, url: string) => {
      const response = await request(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`Request failed (${response.status}): ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(join(stage, path), bytes);
      files.push({ path, url, sha256: digest(bytes) });
      return bytes.toString("utf8");
    };
    try {
      const gauges = parseInventory(await get("index.html", INDEX_URL));
      await get(
        "explanation.html",
        "https://www1.kaiho.mlit.go.jp/TIDE/harmonic/kaisetsu.html",
      );
      await get("terms.html", "https://www1.kaiho.mlit.go.jp/copyright.html");
      for (const gauge of gauges) {
        const html = await get(`${gauge.id}-gauge.html`, gaugeUrl(gauge.id));
        if (hasHarmonics(gauge, html))
          await get(`${gauge.id}-constants.html`, constantsUrl(gauge.id));
      }
      await writeFile(
        join(stage, "manifest.json"),
        JSON.stringify(
          { retrievedAt: new Date().toISOString(), files },
          null,
          2,
        ) + "\n",
      );
      const next = await verifySnapshot(stage);
      const previousPaths: string[] = [];
      if (existsSync(join(dir, "manifest.json"))) {
        const previous = await verifySnapshot(dir);
        previousPaths.push(...previous.contents.keys());
        checkWithdrawals(
          previous.harmonics.map((h) => h.id),
          new Set(next.harmonics.map((h) => h.id)),
          withdrawn,
        );
      }
      await mkdir(dir, { recursive: true });
      for (const file of files)
        await rename(join(stage, file.path), join(dir, file.path));
      await rename(join(stage, "manifest.json"), join(dir, "manifest.json"));
      const keep = new Set(files.map((file) => file.path));
      for (const name of previousPaths)
        if (!keep.has(name)) await rm(join(dir, name));
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = async () => {
    const args = process.argv.slice(2);
    if (
      args.some((arg) => arg !== "--refresh" && !/^--withdraw=\d{4}$/.test(arg))
    )
      throw new Error("Usage: import.ts [--refresh] [--withdraw=NNNN ...]");
    const withdrawn = args
      .filter((arg) => arg.startsWith("--withdraw="))
      .map((arg) => arg.slice("--withdraw=".length));
    if (args.includes("--refresh"))
      await refreshSnapshot(FIXTURES_DIR, globalThis.fetch, withdrawn);
    console.log(
      `Imported ${await importSnapshot(FIXTURES_DIR, DATA_DIR, withdrawn)} JHOD stations.`,
    );
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
