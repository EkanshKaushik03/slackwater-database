/**
 * Print, as Markdown, every merge planMerges would make against the committed
 * catalogue: mechanical merges as one line each, the rest with their evidence,
 * then the groups it refused. With --apply, fold each group into its surviving
 * station file; run `npm run stations` afterwards.
 *
 * Usage: npm run report:merges -w packages/stations > merges.md
 *        npm run merge -w packages/stations
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { planMerges, type MergeGroup } from "./merges.ts";
import {
  mergeStationFiles,
  readStationFiles,
  type StationFile,
} from "./station-files.ts";

const root = join(import.meta.dirname, "..", "..");
const files = readStationFiles(join(root, "stations"));
const catalogue = await loadProductionCatalogue(root, files);
const quality = new Map(
  catalogue.stations.flatMap(({ quality }) =>
    quality ? [[quality.id, quality] as const] : [],
  ),
);
const plan = planMerges(catalogue.stations, catalogue.routes, quality);

const mechanical = plan.groups.filter((group) => group.mechanical);
const review = plan.groups.filter((group) => !group.mechanical);
const redirects = plan.groups.reduce((n, g) => n + g.slugs.length - 1, 0);

const line = (group: MergeGroup) =>
  `- \`${group.survivor}\` ← ${group.slugs
    .slice(1)
    .map((slug) => `\`${slug}\``)
    .join(", ")}`;

const out = [
  "# Station merges",
  "",
  `${plan.groups.length} stations absorb ${redirects} others, whose URLs redirect. ${mechanical.length} merges are mechanical and ${review.length} need review. ${plan.conflicts.length} groups were left unmerged and ${plan.refused.length} declared originators were refused.`,
  "",
  "## Need review",
  "",
  ...review.flatMap((group) => [
    `### \`${group.survivor}\``,
    "",
    "| Record | Published slug | Name | km | Evidence |",
    "|---|---|---|---|---|",
    ...group.members.map(
      (m) =>
        `| ${m.id === group.primary ? `**${m.id}**` : m.id} | ${m.slug} | ${m.name} | ${m.km} | ${m.evidence ? `${m.evidence} of ${m.target}` : ""} |`,
    ),
    "",
  ]),
  "## Left unmerged",
  "",
  "Each would join more than one authoritative record.",
  "",
  ...plan.conflicts.map(
    ({ slugs, authoritative }) =>
      `- ${slugs.map((slug) => `\`${slug}\``).join(", ")}: ${authoritative.join(", ")}`,
  ),
  "",
  "## Refused originators",
  "",
  ...plan.refused.map(
    ({ id, target, reason }) => `- ${id} → ${target}: ${reason}`,
  ),
  "",
  "## Mechanical",
  "",
  "Same name, within 50 m of the primary record.",
  "",
  ...mechanical.map(line),
  "",
];
console.log(out.join("\n"));

if (process.argv.includes("--apply")) {
  const bySlug = new Map(
    files
      .filter(({ kind }) => kind === "tide")
      .map((file) => [file.slug, file]),
  );
  const byId = new Map(
    catalogue.stations.map((station) => [station.id, station]),
  );
  // Plan every merge before writing any, so one refused group leaves the
  // station files as they were.
  const conflicts: string[] = [];
  const merges = [];
  for (const group of plan.groups) {
    const files = group.slugs.map((slug) => {
      const file = bySlug.get(slug);
      if (!file)
        throw new Error(`${slug}: no station file; run npm run stations first`);
      return file;
    });
    const [survivor, ...absorbed] = files as [StationFile, ...StationFile[]];
    const primary = byId.get(group.primary)!;
    // An authoritative primary's geography is right; a relay's can be the
    // relaying agency's country, so the station keeps the one it published.
    const geography = group.authoritative
      ? {
          country: primary.country_code,
          ...(primary.region_code ? { region: primary.region_code } : {}),
        }
      : {
          country: survivor.country,
          ...(survivor.region ? { region: survivor.region } : {}),
        };
    const merged = await mergeStationFiles(
      survivor,
      absorbed,
      files.find(({ sources }) => sources.includes(group.primary))!,
      geography,
      root,
    );
    conflicts.push(...merged.conflicts);
    merges.push(merged);
  }
  for (const merged of merges) {
    for (const file of merged.remove) rmSync(join(root, file));
    if (merged.write.from) rmSync(join(root, merged.write.from));
    mkdirSync(dirname(join(root, merged.write.file)), { recursive: true });
    writeFileSync(join(root, merged.write.file), merged.write.text);
  }
  console.error(
    `merged ${plan.groups.length} stations; ${conflicts.length} curated fields dropped:\n${conflicts.join("\n")}`,
  );
}
