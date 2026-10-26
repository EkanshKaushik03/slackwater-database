/**
 * Warn, as CI annotations, when the results release the station files cite is
 * more than 45 days old, when a newer results release exists, or when either
 * cannot be read. Always exits 0.
 *   npm run report:chs-fit-age -w packages/stations
 */
import { compareTags } from "./chs-fit-evidence.ts";
import {
  CHS_FIT_EVIDENCE,
  readStationFiles,
  type StationFile,
} from "./station-files.ts";

const REPO = "https://api.github.com/repos/openwatersio/chs-current-validation";
const STALE_DAYS = 45;

/** The newest tag the station files cite, by date and then run number. */
export function newestTag(
  files: Pick<StationFile, "chs_fit">[],
): string | null {
  const tags = [
    ...new Set(files.flatMap((f) => (f.chs_fit ? [f.chs_fit.evidence] : []))),
  ];
  return tags.sort((x, y) => compareTags(y, x))[0] ?? null;
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
      compareTags(latestTag, cited) > 0
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
  const cited = newestTag(readStationFiles());
  if (!cited) return;
  const [release, latest] = await Promise.allSettled([
    get(`${REPO}/releases/tags/${cited}`),
    get(`${REPO}/releases/latest`),
  ]);
  const failed = (result: PromiseRejectedResult) =>
    console.log(
      `::warning::Could not check the CHS current results age: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
  if (release.status === "rejected") failed(release);
  if (latest.status === "rejected") failed(latest);
  for (const line of ageWarnings(
    cited,
    release.status === "fulfilled" ? release.value["published_at"] : null,
    latest.status === "fulfilled" ? latest.value["tag_name"] : null,
    new Date(),
  ))
    console.log(line);
}

if (import.meta.main) main();
