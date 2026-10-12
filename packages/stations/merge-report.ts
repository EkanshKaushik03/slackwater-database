/**
 * Print, as Markdown, every merge planMerges would make against the committed
 * catalogue: mechanical merges as one line each, the rest with their evidence,
 * then the groups it refused. Publishes nothing.
 *
 * Usage: npm run merge-report -w packages/stations > merges.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StationQuality } from "@slackwater/database";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { planMerges, type MergeGroup } from "./merges.ts";

const root = join(import.meta.dirname, "..", "..");
const catalogue = await loadProductionCatalogue(root);
const quality = new Map<string, StationQuality>(
  JSON.parse(readFileSync(join(root, "quality.json"), "utf8")).map(
    (entry: StationQuality) => [entry.id, entry],
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
  "Each would join more than one accepted authoritative record.",
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
