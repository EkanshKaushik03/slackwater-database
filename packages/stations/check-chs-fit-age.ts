/**
 * Warn, as CI annotations, when the results release the station files cite is
 * more than 45 days old, when a newer results release exists, or when either
 * cannot be read. Always exits 0.
 *   npm run report:chs-fit-age -w packages/stations
 */
import { compareTags, tagStamp } from "./chs-fit-evidence.ts";
import {
  CHS_FIT_EVIDENCE,
  readStationFiles,
  type StationFile,
} from "./station-files.ts";

const REPO = "https://api.github.com/repos/openwatersio/chs-current-validation";
const STALE_DAYS = 45;

/** The newest tag the station files cite in each recipe stamp, oldest stamp first. */
export function newestTags(files: Pick<StationFile, "chs_fit">[]): string[] {
  const newest = new Map<string, string>();
  for (const f of files) {
    const tag = f.chs_fit?.evidence;
    if (!tag) continue;
    const stamp = tagStamp(tag);
    const have = newest.get(stamp);
    if (!have || compareTags(tag, have)! > 0) newest.set(stamp, tag);
  }
  return [...newest.values()].sort();
}

/** A warning naming the stamps when the files cite more than one. */
export function stampWarnings(tags: string[]): string[] {
  return tags.length > 1
    ? [
        `::warning::The station files cite CHS current results of ${tags.length} recipe stamps: ${tags.join(", ")}`,
      ]
    : [];
}

/**
 * The warnings for the cited release's publication date and the latest
 * release's tag, given today's date. A null `latestTag` is a lookup that
 * already warned.
 */
export function ageWarnings(
  cited: string,
  citedPublishedAt: unknown,
  latestTag: unknown,
  now: Date,
): string[] {
  const warnings: string[] = [];
  if (citedPublishedAt !== null) {
    const published =
      typeof citedPublishedAt === "string" ? Date.parse(citedPublishedAt) : NaN;
    if (Number.isNaN(published))
      warnings.push(
        `::warning::The CHS current results release ${cited} has no readable published_at`,
      );
    else {
      const days = Math.floor((now.getTime() - published) / 86_400_000);
      if (days > STALE_DAYS)
        warnings.push(
          `::warning::The CHS current results release the station files cite, ${cited}, was published ${days} days ago`,
        );
    }
  }
  if (latestTag !== null) {
    if (typeof latestTag !== "string" || !latestTag)
      warnings.push(
        "::warning::The latest CHS current results release has no readable tag_name",
      );
    else if (
      CHS_FIT_EVIDENCE.test(latestTag) &&
      (compareTags(latestTag, cited) ?? 0) > 0
    )
      warnings.push(
        `::warning::A newer CHS current results release exists: ${latestTag}; the station files cite ${cited}`,
      );
  }
  return warnings;
}

async function get(url: string): Promise<Record<string, unknown>> {
  const token = process.env["GITHUB_TOKEN"];
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function main() {
  const cited = newestTags(readStationFiles());
  for (const line of stampWarnings(cited)) console.log(line);
  const latest = await Promise.allSettled([
    get(`${REPO}/releases/latest`),
  ]).then(([r]) => r!);
  const failed = (result: PromiseRejectedResult) =>
    console.log(
      `::warning::Could not check the CHS current results age: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
  if (latest.status === "rejected") failed(latest);
  const lines = new Set<string>();
  for (const tag of cited) {
    const [release] = await Promise.allSettled([
      get(`${REPO}/releases/tags/${tag}`),
    ]);
    if (release!.status === "rejected") failed(release!);
    for (const line of ageWarnings(
      tag,
      release!.status === "fulfilled" ? release!.value["published_at"] : null,
      latest.status === "fulfilled" ? latest.value["tag_name"] : null,
      new Date(),
    ))
      lines.add(line);
  }
  for (const line of lines) console.log(line);
}

if (import.meta.main)
  main().catch((error) =>
    console.log(
      `::warning::Could not check the CHS current results age: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
