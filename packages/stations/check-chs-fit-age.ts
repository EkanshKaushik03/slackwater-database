/**
 * Warn, as a CI annotation, when the newest CHS current results release is
 * more than 45 days old, or cannot be read. Always exits 0.
 *   npm run report:chs-fit-age -w packages/stations
 */
const LATEST =
  "https://api.github.com/repos/openwatersio/chs-current-validation/releases/latest";
const STALE_DAYS = 45;

try {
  const token = process.env["GITHUB_TOKEN"];
  const response = await fetch(LATEST, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) throw new Error(`${LATEST}: HTTP ${response.status}`);
  const { tag_name, published_at } = (await response.json()) as {
    tag_name: string;
    published_at: string;
  };
  const days = Math.floor((Date.now() - Date.parse(published_at)) / 86_400_000);
  if (days > STALE_DAYS)
    console.log(
      `::warning::The newest CHS current results release, ${tag_name}, was published ${days} days ago`,
    );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    `::warning::Could not check the CHS current results age: ${message}`,
  );
}
