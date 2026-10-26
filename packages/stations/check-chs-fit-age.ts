/**
 * Warn, as CI annotations, when the results release the station files cite is
 * more than 45 days old, when a newer results release exists, or when either
 * cannot be read. Always exits 0.
 *   npm run report:chs-fit-age -w packages/stations
 */
import { readStationFiles, type StationFile } from "./station-files.ts";

const REPO = "https://api.github.com/repos/openwatersio/chs-current-validation";
const STALE_DAYS = 45;

/** The newest tag: the latest date in it, then the highest run number. */
export function newestTag(
  files: Pick<StationFile, "chs_fit">[],
): string | null {
  const key = (tag: string) => {
    const [, date, run] = /^fit-(\d{4}-\d{2}-\d{2})-[0-9a-f]{7}-r(\d+)$/.exec(
      tag,
    )!;
    return { date: date!, run: Number(run) };
  };
  const tags = [
    ...new Set(files.flatMap((f) => (f.chs_fit ? [f.chs_fit.evidence] : []))),
  ];
  return (
    tags.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x.date < y.date ? 1 : x.date > y.date ? -1 : y.run - x.run;
    })[0] ?? null
  );
}

/** The warnings for the cited release and the latest one, given today's date. */
export function ageWarnings(
  cited: string,
  citedPublishedAt: unknown,
  latestTag: unknown,
  now: Date,
): string[] {
  const warnings: string[] = [];
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
  if (typeof latestTag !== "string" || !latestTag)
    warnings.push(
      "::warning::The latest CHS current results release has no readable tag_name",
    );
  else if (latestTag !== cited)
    warnings.push(
      `::warning::A newer CHS current results release exists: ${latestTag}; the station files cite ${cited}`,
    );
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
  const [release, latest] = await Promise.all([
    get(`${REPO}/releases/tags/${cited}`),
    get(`${REPO}/releases/latest`),
  ]);
  for (const line of ageWarnings(
    cited,
    release["published_at"],
    latest["tag_name"],
    new Date(),
  ))
    console.log(line);
}

if (import.meta.main)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `::warning::Could not check the CHS current results age: ${message}`,
    );
  });
