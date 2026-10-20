import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
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

export async function importSnapshot(dir = FIXTURES_DIR, dataDir = DATA_DIR) {
  const { harmonics } = await verifySnapshot(dir);
  // Build every record before replacing anything, so a bad page preserves the current data.
  const records = harmonics.map((h) => ({
    id: h.id,
    data: withPublishedPrecision("jhod", buildStation(h)),
  }));
  const out = join(dataDir, "jhod");
  await mkdir(out, { recursive: true });
  for (const record of records)
    await writeFile(
      join(out, `${record.id}.json`),
      JSON.stringify(record.data, null, 2) + "\n",
    );
  const keep = new Set(records.map((r) => `${r.id}.json`));
  for (const name of await readdir(out))
    if (name.endsWith(".json") && !keep.has(name)) await rm(join(out, name));
  return records.length;
}

export async function refreshSnapshot(
  dir = FIXTURES_DIR,
  request = globalThis.fetch,
) {
  await mkdir(dirname(dir), { recursive: true });
  const stage = await mkdtemp(join(dirname(dir), ".jhod-refresh-"));
  const files: File[] = [];
  const get = async (path: string, url: string) => {
    const response = await request(url);
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
    await verifySnapshot(stage);
    await mkdir(dir, { recursive: true });
    for (const file of files)
      await rename(join(stage, file.path), join(dir, file.path));
    await rename(join(stage, "manifest.json"), join(dir, "manifest.json"));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = async () => {
    if (process.argv.includes("--refresh")) await refreshSnapshot();
    console.log(`Imported ${await importSnapshot()} JHOD stations.`);
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
