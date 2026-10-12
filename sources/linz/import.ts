#!/usr/bin/env node
/**
 * Import LINZ's published tide constituents.
 *
 *   npm run import -w sources/linz [-- <zip url>]
 *
 * With no URL, the zip linked from LINZ's tide-constituents page is used. The
 * release is downloaded to tmp/linz and only data/linz is written.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "@slackwater/stations";
import { buildStation, parseHarmonics, siteId } from "./linz.ts";

const PAGE_URL =
  "https://www.linz.govt.nz/products-services/data/types-linz-data/sea-level-data/tide-constituents";
const TMP_DIR = join(DATA_DIR, "..", "tmp", "linz");
// LINZ's CDN refuses requests without a browser-like User-Agent.
const HEADERS = { "User-Agent": "Mozilla/5.0 (slackwater-database importer)" };

async function get(url: string) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok)
    throw new Error(`Request failed (${response.status}): ${url}`);
  return response;
}

/** The constituent zip the tide-constituents page links to. */
export async function releaseUrl(page?: string) {
  const html = page ?? (await (await get(PAGE_URL)).text());
  const links = [
    ...html.matchAll(/href="([^"]*Tide_Constituents[^"]*\.zip)"/gi),
  ].map(([, href]) => new URL(href!, PAGE_URL).toString());
  if (new Set(links).size !== 1)
    throw new Error(`Expected one constituent zip on ${PAGE_URL}`);
  return links[0]!;
}

/** Download and unpack a release, returning the folder of analysis files. */
async function fetchRelease(url: string) {
  const dir = join(TMP_DIR, basename(new URL(url).pathname, ".zip"));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const zip = join(dir, "release.zip");
  await writeFile(zip, Buffer.from(await (await get(url)).arrayBuffer()));
  // Extraction flattens folders, so two files of one name would collide.
  const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
    .split("\n")
    .filter((entry) => entry.endsWith(".txt"))
    .map((entry) => entry.split("/").at(-1)!);
  if (new Set(entries).size !== entries.length)
    throw new Error("Release has two files with one name");
  execFileSync("unzip", ["-q", "-o", "-j", zip, "*.txt", "-d", dir]);
  return dir;
}

/** Parse every analysis in `dir`, write its stations, and remove the rest. */
export async function importDirectory(dir: string, dataDir = DATA_DIR) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".txt"));
  // Checked before anything is removed, so a bad archive cannot empty data/linz.
  if (names.length === 0) throw new Error(`No LINZ analysis files in ${dir}`);
  const stations = await Promise.all(
    names.map(async (name) =>
      parseHarmonics(await readFile(join(dir, name), "utf8"), siteId(name)),
    ),
  );
  const ids = stations.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Release has two files for one LINZ site");

  const out = join(dataDir, "linz");
  await mkdir(out, { recursive: true });
  const keep = new Set(ids.map((id) => `${id}.json`));
  for (const name of await readdir(out))
    if (name.endsWith(".json") && !keep.has(name)) await rm(join(out, name));
  for (const harmonics of stations)
    await writeFile(
      join(out, `${harmonics.id}.json`),
      `${JSON.stringify(buildStation(harmonics), null, 2)}\n`,
    );
  return stations.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = async () => {
    const url = process.argv[2] ?? (await releaseUrl());
    console.log(`LINZ release: ${url}`);
    const count = await importDirectory(await fetchRelease(url));
    console.log(`Imported ${count} LINZ stations.`);
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
