/**
 * One YAML file per published station: `stations/<kind>/<country>/<slug>.yaml`.
 *
 * The file holds what people decide about a station — which provider records
 * it publishes, its curated name and position, the paths it used to answer at
 * — and a `computed` block that `npm run stations` writes. See
 * stations/README.md for the curation rules.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { format } from "prettier";
import { Document, parse, parseDocument, YAMLMap } from "yaml";
import type { DatabaseRoutes, StationQuality } from "@slackwater/database";
import type {
  Corrections,
  Registry,
  RegistryRecord,
  ResolvedStation,
} from "./metadata.ts";
// From source, not the package entry, as routes.ts does.
import { routePath } from "../database/src/route-path.ts";
import { classifyPosition } from "./position-audit.ts";
import type { StationKind } from "./routes.ts";

export const ROOT = join(import.meta.dirname, "..", "..");
export const STATIONS_DIR = join(ROOT, "stations");

export interface ComputedSource {
  position: [number, number];
  coastline: "verified" | "unverifiable" | "clear" | "ashore";
  metres_inland?: number;
  /** A provider tide record's quality evaluation. */
  quality?: Omit<StationQuality, "id">;
}

export interface StationFile {
  kind: StationKind;
  /** ISO 3166-1 alpha-2, from the file's directory. */
  country: string;
  /** From the file name. Unique per kind. */
  slug: string;
  /** Repo-relative path of the file. */
  file: string;
  /** ISO 3166-2 code of the route's region segment, when it has one. */
  region?: string;
  sources: string[];
  /** Records the provider no longer publishes. */
  retired_sources?: string[];
  redirect_from?: string[];
  name?: string;
  context?: string;
  aliases?: string[];
  cities?: string[];
  position?: [number, number];
  position_verified?: true;
  provider?: string;
  tide_reference?: string;
  magnitude_note?: string;
  derived?: {
    reference: string;
    high_water_lag_minutes: number;
    low_water_lag_minutes: number;
  };
  computed?: { sources?: Record<string, ComputedSource> };
}

// In the order a file lists them: curated fields, membership, then computed.
const KEYS = new Set([
  "name",
  "context",
  "region",
  "aliases",
  "cities",
  "position",
  "position_verified",
  "provider",
  "tide_reference",
  "magnitude_note",
  "derived",
  "sources",
  "retired_sources",
  "redirect_from",
  "computed",
]);
const KINDS: Record<string, StationKind> = { tide: "tide", current: "current" };

/** The route path a station file publishes, e.g. `/tides/us/wa/everett/`. */
export function filePath({ kind, country, region, slug }: StationFile): string {
  return routePath(kind, { slug, country_code: country, region_code: region });
}

/** Where a station with this kind, country and slug is stored. */
export function stationFileName(
  kind: StationKind,
  country: string,
  slug: string,
): string {
  return join("stations", kind, country.toLowerCase(), `${slug}.yaml`);
}

export function readStationFiles(dir = STATIONS_DIR): StationFile[] {
  if (!existsSync(dir)) return [];
  const files: StationFile[] = [];
  const problems: string[] = [];
  const dirs = (path: string) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
  // Anything else under stations/ is a station someone misfiled, whose
  // records would silently get new stations.
  const stray = (path: string) => !/(^|\/)\.[^/]*$/.test(path);
  for (const entry of readdirSync(dir))
    if (!KINDS[entry] && entry !== "README.md" && stray(entry))
      problems.push(`stations/${entry}: not a station kind`);
  for (const kindDir of dirs(dir)) {
    const kind = KINDS[kindDir];
    if (!kind) continue;
    for (const entry of readdirSync(join(dir, kindDir)))
      if (!/^[a-z]{2}$/.test(entry) && stray(entry))
        problems.push(`stations/${kindDir}/${entry}: not a country directory`);
    for (const country of dirs(join(dir, kindDir)).filter((c) =>
      /^[a-z]{2}$/.test(c),
    )) {
      for (const name of readdirSync(join(dir, kindDir, country)).sort()) {
        if (!stray(name)) continue;
        if (!/^[a-z0-9]+(-[a-z0-9]+)*\.yaml$/.test(name)) {
          problems.push(
            `stations/${kindDir}/${country}/${name}: not a station file`,
          );
          continue;
        }
        const path = join(dir, kindDir, country, name);
        const file = relative(join(dir, ".."), path);
        const value = parse(readFileSync(path, "utf8")) ?? {};
        for (const key of Object.keys(value))
          if (!KEYS.has(key)) problems.push(`${file}: unknown field ${key}`);
        const ids = (field: string) =>
          value[field] === undefined ||
          (Array.isArray(value[field]) &&
            value[field].every((id: unknown) => typeof id === "string"));
        if (!Array.isArray(value.sources) || !ids("sources"))
          problems.push(`${file}: sources must be a list of record ids`);
        if (!ids("retired_sources"))
          problems.push(
            `${file}: retired_sources must be a list of record ids`,
          );
        for (const path of value.redirect_from ?? [])
          // A station redirects only its own kind's paths.
          if (
            !new RegExp(
              `^/${kind === "tide" ? "tides" : "currents"}/[a-z]{2}/([a-z0-9]+/)?[a-z0-9-]+/$`,
            ).test(path)
          )
            problems.push(
              `${file}: redirect ${JSON.stringify(path)} is not a route path`,
            );
        for (const field of ["tide_reference", "magnitude_note", "derived"])
          if (value[field] !== undefined && value.provider === undefined)
            problems.push(
              `${file}: ${field} describes a record this repo owns; it needs provider`,
            );
        if (
          value.region !== undefined &&
          !String(value.region).startsWith(`${country.toUpperCase()}-`)
        )
          problems.push(
            `${file}: region ${value.region} is not in ${country.toUpperCase()}`,
          );
        if (
          value.position_verified !== undefined &&
          value.position_verified !== true
        )
          problems.push(`${file}: position_verified must be true when set`);
        files.push({
          ...value,
          kind,
          country: country.toUpperCase(),
          slug: name.slice(0, -".yaml".length),
          file,
        });
      }
    }
  }
  // A slug is unique per kind, though only a country's own directory stops two
  // files sharing one, and no station takes a slug another redirects from,
  // since consumers resolve a bare /tides/<slug>/ share link by slug. A record
  // and a redirect belong to exactly one station.
  const owners = new Map<string, string>();
  const claim = (key: string, file: StationFile) => {
    if (owners.has(key) && owners.get(key) !== file.file)
      problems.push(`${file.file}: ${key} is also in ${owners.get(key)}`);
    owners.set(key, file.file);
  };
  for (const file of files) {
    if (!Array.isArray(file.sources)) continue;
    claim(`${file.kind} slug ${file.slug}`, file);
    for (const id of [...file.sources, ...(file.retired_sources ?? [])])
      claim(`${file.kind} record ${id}`, file);
    for (const path of file.redirect_from ?? []) {
      claim(`path ${path}`, file);
      const slug = path.split("/").filter(Boolean).at(-1)!;
      if (slug !== file.slug) claim(`${file.kind} slug ${slug}`, file);
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return files;
}

/**
 * The curated records the catalogue resolves stations with. A station with a
 * `provider` holds a record this repo owns — the one source no provider
 * supplies — and its curated fields define that record. Otherwise its curated
 * fields apply to every source. Every source takes the station's country and
 * region, so its URL does not move when derived geography does.
 */
export function curatedRecords(
  files: StationFile[],
  providerIds: Set<string>,
): { corrections: Corrections; registry: Registry } {
  const corrections: Corrections = new Map();
  const registry: Registry = new Map();
  for (const file of files) {
    // A station without a region keeps none, so a derived one cannot move it.
    const location = {
      countryCode: file.country,
      regionCode: file.region ?? null,
    };
    const curated = {
      ...(file.name ? { name: file.name } : {}),
      ...(file.context ? { context: file.context } : {}),
      ...(file.aliases ? { aliases: file.aliases } : {}),
      ...(file.cities ? { cities: file.cities } : {}),
      ...(file.position ? { position: file.position } : {}),
      ...(file.position_verified ? { positionVerified: true as const } : {}),
      location,
    };
    // An owned id has no source prefix; a provider id no source supplies is a
    // record that vanished, which `npm run stations` retires.
    // A retired record takes the curation too, so it rejoins its station
    // unchanged if the provider publishes it again.
    const members = [...file.sources, ...(file.retired_sources ?? [])];
    const owned = file.sources.filter(
      (id) => !providerIds.has(id) && !id.includes("/"),
    );
    if (file.provider) {
      if (owned.length !== 1)
        throw new Error(
          `${file.file}: a station with a provider owns exactly one record not supplied by any source, found ${owned.length}`,
        );
      const record: RegistryRecord = {
        ...curated,
        provider: file.provider,
        kind: file.kind,
        ...(file.tide_reference ? { tideReference: file.tide_reference } : {}),
        ...(file.magnitude_note ? { magnitudeNote: file.magnitude_note } : {}),
        ...(file.derived
          ? {
              derived: {
                reference: file.derived.reference,
                hwLagMinutes: file.derived.high_water_lag_minutes,
                lwLagMinutes: file.derived.low_water_lag_minutes,
              },
            }
          : {}),
      };
      registry.set(owned[0]!, record);
      for (const id of members)
        if (id !== owned[0]) corrections.set(id, { location });
    } else {
      for (const id of members) corrections.set(id, curated);
    }
  }
  return { corrections, registry };
}

/** What `npm run stations` decides about a station; everything else is curated. */
export interface StationUpdate {
  kind: StationKind;
  country: string;
  region?: string;
  slug: string;
  sources: string[];
  retired_sources: string[];
  redirect_from: string[];
  computed: Record<string, ComputedSource>;
}

const WRITTEN_BY = " Written by `npm run stations`. Do not edit.";

/**
 * Render a station file: `previous` keeps every curated field and comment, and
 * the update replaces what `npm run stations` owns. Formatted as prettier would.
 */
export async function renderStationFile(
  previous: string | undefined,
  update: StationUpdate,
): Promise<string> {
  const doc = previous ? parseDocument(previous) : new Document({});
  if (!(doc.contents instanceof YAMLMap)) doc.contents = new YAMLMap();
  const set = (key: string, value: unknown) => {
    if (value === undefined || (Array.isArray(value) && !value.length))
      doc.delete(key);
    else doc.set(key, doc.createNode(value));
  };
  // A list keeps each surviving item's node, and so the comments people write
  // beside a record or a redirect. A record moving between `sources` and
  // `retired_sources` keeps its comment.
  const nodes = new Map<string, any>();
  for (const key of ["sources", "retired_sources", "redirect_from"]) {
    const previous = doc.get(key, true) as any;
    // A comment above the first item parses onto the list; it belongs to the item.
    const first = previous?.items?.[0];
    if (previous?.commentBefore && first) {
      first.commentBefore = [previous.commentBefore, first.commentBefore]
        .filter(Boolean)
        .join("\n");
      previous.commentBefore = undefined;
    }
    for (const node of previous?.items ?? [])
      nodes.set(String(node.value), node);
  }
  const setList = (key: string, values: string[], keepEmpty = false) => {
    if (!values.length && !keepEmpty) {
      doc.delete(key);
      return;
    }
    const next = doc.createNode(values) as any;
    next.items = values.map(
      (value, index) => nodes.get(value) ?? next.items[index],
    );
    doc.set(key, next);
  };
  // A retired station keeps its file, holding its slug and paths.
  setList("sources", update.sources, true);
  set("region", update.region);
  setList("retired_sources", update.retired_sources);
  setList("redirect_from", update.redirect_from);
  const previousComment = String(
    (
      (doc.contents as YAMLMap).items.find(
        (pair) => String((pair.key as any)?.value ?? pair.key) === "computed",
      )?.key as any
    )?.commentBefore ?? "",
  )
    .split("\n")
    .filter((line) => line.trim() && !/^ Written by `npm run /.test(line))
    .join("\n");
  doc.delete("computed");
  doc.set("computed", doc.createNode({ sources: update.computed }));
  const map = doc.contents as YAMLMap;
  const order = [...KEYS];
  map.items.sort(
    (a, b) =>
      order.indexOf(String((a.key as any)?.value ?? a.key)) -
      order.indexOf(String((b.key as any)?.value ?? b.key)),
  );
  const computed = map.items.at(-1)!;
  const key = doc.createNode("computed");
  key.commentBefore = [previousComment, WRITTEN_BY].filter(Boolean).join("\n");
  computed.key = key;
  for (const pair of map.items) {
    const name = String((pair.key as any)?.value ?? pair.key);
    if (["aliases", "cities", "position", "derived"].includes(name))
      (pair.value as any).flow = true;
  }
  // One record per block, its position on one line.
  for (const source of (computed.value as any).items[0].value.items)
    source.value.get("position", true).flow = true;
  return format(doc.toString({ lineWidth: 0 }), { parser: "yaml" });
}

export interface PlannedFile {
  /** Repo-relative path the station should live at. */
  file: string;
  /** Its current path, when it must move there. */
  from?: string;
  text: string;
}

/**
 * Every station file as `npm run stations` would write it: each route's members,
 * path and redirects, records the provider stopped publishing, and each
 * record's position and coastline verdict. Unchanged files are left out.
 */
export async function planStationFiles(
  files: StationFile[],
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
  root = ROOT,
): Promise<PlannedFile[]> {
  const byId = new Map(stations.map((station) => [station.id, station]));
  const bySlug = new Map(
    files.map((file) => [`${file.kind}/${file.slug}`, file]),
  );
  const planned: PlannedFile[] = [];
  const plan = async (
    previous: StationFile | undefined,
    update: StationUpdate,
  ) => {
    const file = stationFileName(update.kind, update.country, update.slug);
    const text = previous
      ? readFileSync(join(root, previous.file), "utf8")
      : undefined;
    const next = await renderStationFile(text, update);
    if (next !== text || previous?.file !== file)
      planned.push({
        file,
        ...(previous && previous.file !== file ? { from: previous.file } : {}),
        text: next,
      });
  };
  const routed = new Set<string>();
  for (const kind of ["tide", "current"] as const) {
    for (const route of routes[kind]) {
      const previous = bySlug.get(`${kind}/${route.slug}`);
      routed.add(`${kind}/${route.slug}`);
      const first = byId.get(route.station_ids[0]!)!;
      const live = new Set(route.station_ids);
      await plan(previous, {
        kind,
        country: first.country_code,
        ...(first.region_code ? { region: first.region_code } : {}),
        slug: route.slug,
        sources: route.station_ids,
        // A retired record the provider publishes again rejoins its station.
        retired_sources: [
          ...new Set([
            ...(previous?.retired_sources ?? []),
            ...(previous?.sources ?? []),
          ]),
        ]
          .filter((id) => !live.has(id))
          .sort(),
        redirect_from: route.former_paths ?? [],
        computed: Object.fromEntries(
          route.station_ids.map((id) => {
            const station = byId.get(id)!;
            const { verdict, ...rest } = classifyPosition(station);
            return [
              id,
              {
                position: [station.latitude, station.longitude],
                coastline: verdict,
                ...("metresInland" in rest
                  ? { metres_inland: rest.metresInland }
                  : {}),
                ...(station.quality
                  ? { quality: storedForm(station.quality) }
                  : {}),
              },
            ];
          }),
        ),
      });
    }
  }
  // A station none of whose records remain keeps its slug and paths.
  for (const file of files) {
    if (routed.has(`${file.kind}/${file.slug}`)) continue;
    await plan(file, {
      kind: file.kind,
      country: file.country,
      ...(file.region ? { region: file.region } : {}),
      slug: file.slug,
      sources: [],
      retired_sources: [
        ...(file.retired_sources ?? []),
        ...file.sources,
      ].sort(),
      redirect_from: file.redirect_from ?? [],
      computed: {},
    });
  }
  return planned;
}

const CURATED = [
  "name",
  "context",
  "aliases",
  "cities",
  "position",
  "position_verified",
  "provider",
  "tide_reference",
  "magnitude_note",
  "derived",
] as const;

/**
 * Fold several stations into the one whose slug survives: every record joins
 * it, every other station's path and redirects become its redirects, and it
 * takes the given geography. The curated fields of the station that held the
 * primary record define it; another station's curated fields described its own
 * record and are dropped, and reported for a person. A station this repo owns
 * must hold the primary, since its fields define the owned record.
 */
export async function mergeStationFiles(
  survivor: StationFile,
  absorbed: StationFile[],
  primary: StationFile,
  geography: { country: string; region?: string },
  root = ROOT,
): Promise<{ write: PlannedFile; remove: string[]; conflicts: string[] }> {
  const doc = parseDocument(readFileSync(join(root, survivor.file), "utf8"));
  const conflicts: string[] = [];
  const all = [survivor, ...absorbed];
  for (const file of all)
    if (file.provider && file !== primary)
      throw new Error(
        `${file.file}: an owned station can only absorb, holding the primary record`,
      );
  // A station whose curation is dropped loses the comments that explained it.
  const dropsCuration = (file: StationFile) =>
    file !== primary &&
    CURATED.some(
      (field) =>
        file[field] !== undefined &&
        JSON.stringify(file[field]) !== JSON.stringify(primary[field]),
    );
  const comments = new Set(
    all
      .filter((file) => !dropsCuration(file))
      .map(
        (file) =>
          parseDocument(readFileSync(join(root, file.file), "utf8"))
            .commentBefore,
      )
      .filter((comment): comment is string => !!comment?.trim()),
  );
  for (const field of CURATED) {
    for (const file of all)
      if (
        file !== primary &&
        file[field] !== undefined &&
        JSON.stringify(file[field]) !== JSON.stringify(primary[field])
      )
        conflicts.push(`${survivor.file}: dropped ${field} from ${file.file}`);
    if (primary[field] === undefined) doc.delete(field);
    else if (JSON.stringify(survivor[field]) !== JSON.stringify(primary[field]))
      doc.set(field, doc.createNode(primary[field]));
  }
  const { region: _, ...rest } = survivor;
  const next: StationFile = {
    ...rest,
    country: geography.country,
    ...(geography.region ? { region: geography.region } : {}),
  };
  const redirects = new Set([
    ...all.flatMap((file) => file.redirect_from ?? []),
    ...all.map(filePath),
  ]);
  redirects.delete(filePath(next));
  doc.commentBefore = comments.size ? [...comments].join("\n") : null;
  const rendered = await renderStationFile(doc.toString({ lineWidth: 0 }), {
    kind: survivor.kind,
    country: next.country,
    ...(next.region ? { region: next.region } : {}),
    slug: survivor.slug,
    sources: [...new Set(all.flatMap(({ sources }) => sources))].sort(),
    retired_sources: [
      ...new Set(all.flatMap(({ retired_sources = [] }) => retired_sources)),
    ].sort(),
    redirect_from: [...redirects].sort(),
    computed: Object.assign(
      {},
      ...all.map(({ computed }) => computed?.sources ?? {}),
    ),
  });
  const file = stationFileName(survivor.kind, next.country, survivor.slug);
  return {
    write: {
      file,
      ...(file !== survivor.file ? { from: survivor.file } : {}),
      text: rendered,
    },
    remove: absorbed.map(({ file }) => file),
    conflicts,
  };
}

/** A quality evaluation as a station file stores it: no id, no empty issues. */
function storedForm({
  accepted,
  reason,
  redundant,
  seasonal_dominant,
  score,
  factors,
  issues,
}: StationQuality): Omit<StationQuality, "id"> {
  // The outcome first, then what it was weighed on.
  return {
    accepted,
    ...(reason ? { reason } : {}),
    ...(redundant ? { redundant } : {}),
    ...(seasonal_dominant ? { seasonal_dominant } : {}),
    score,
    ...(factors ? { factors } : {}),
    ...(issues?.length ? { issues } : {}),
  };
}

/** Every record's quality evaluation as the station files record it. */
export function storedQuality(
  files: StationFile[],
): Map<string, StationQuality> {
  return new Map(
    files.flatMap(({ computed }) =>
      Object.entries(computed?.sources ?? {}).flatMap(([id, { quality }]) =>
        quality ? [[id, { id, issues: [], ...quality }] as const] : [],
      ),
    ),
  );
}

/**
 * Every path the station files hold: each station's and its redirects. A
 * retired station publishes no route but keeps its paths, so they never
 * change hands.
 */
export function publishedPaths(files: StationFile[]): Set<string> {
  return new Set(
    files.flatMap((file) => [filePath(file), ...(file.redirect_from ?? [])]),
  );
}

/**
 * Every path a git ref publishes, read from its station files, or from the
 * route lock that came before them.
 */
export function publishedPathsAt(ref: string, root = ROOT): Set<string> {
  const files = stationFilesAt(ref, root);
  if (files) return publishedPaths(files);
  const lock = JSON.parse(
    execFileSync("git", ["show", `${ref}:metadata/routes.lock.json`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 30,
    }),
  );
  return new Set(
    Object.values(lock).flatMap((routes: any) =>
      Object.values(routes).flatMap((route: any) => [
        route.path,
        ...route.former_paths,
      ]),
    ),
  );
}

/** A git ref's station files, or undefined when it has none. */
export function stationFilesAt(
  ref: string,
  root = ROOT,
): StationFile[] | undefined {
  const names = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", ref, "--", "stations"],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 },
  )
    .split("\n")
    .filter((name) =>
      /^stations\/(tide|current)\/[a-z]{2}\/[^/]+\.yaml$/.test(name),
    );
  if (!names.length) return undefined;
  // One `git cat-file --batch` read: a header line, the content, a newline.
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    maxBuffer: 1 << 30,
    input: names.map((name) => `${ref}:${name}`).join("\n") + "\n",
  });
  const files: StationFile[] = [];
  let at = 0;
  for (const name of names) {
    const end = out.indexOf(10, at);
    const size = Number(out.subarray(at, end).toString().split(" ")[2]);
    const text = out.subarray(end + 1, end + 1 + size).toString("utf8");
    at = end + 1 + size + 1;
    const [, kind, country, slug] = name.match(
      /^stations\/(tide|current)\/([a-z]{2})\/(.+)\.yaml$/,
    )!;
    files.push({
      ...(parse(text) ?? {}),
      kind: kind as StationKind,
      country: country!.toUpperCase(),
      slug: slug!,
      file: name,
    });
  }
  return files;
}

/**
 * Paths a later set of station files hands to different water: each path an
 * earlier station held that is now held by a station sharing none of its
 * records. A merge or a move keeps a record, so it passes.
 */
export function pathsChangingHands(
  before: StationFile[],
  after: StationFile[],
): string[] {
  const records = (file: StationFile) =>
    new Set([...file.sources, ...(file.retired_sources ?? [])]);
  const holders = new Map<string, StationFile>();
  for (const file of after)
    for (const path of [filePath(file), ...(file.redirect_from ?? [])])
      holders.set(path, file);
  return before.flatMap((file) => {
    const was = records(file);
    return [filePath(file), ...(file.redirect_from ?? [])].flatMap((path) => {
      const holder = holders.get(path);
      return holder && ![...records(holder)].some((id) => was.has(id))
        ? [`${path}: ${file.file} -> ${holder.file}`]
        : [];
    });
  });
}

/** More records than this retiring in one run needs STATIONS_RETIRE=1. */
export const RETIRE_LIMIT = 10;

/** Records the planned files retire that were not retired before. */
export function newlyRetired(
  files: StationFile[],
  planned: PlannedFile[],
): string[] {
  const was = new Set(
    files.flatMap(({ retired_sources = [] }) => retired_sources),
  );
  return planned.flatMap(({ text }) =>
    ((parse(text)?.retired_sources ?? []) as string[]).filter(
      (id) => !was.has(id),
    ),
  );
}
