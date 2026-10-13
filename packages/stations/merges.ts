/**
 * Which tide routes publish the same physical gauge, and so should become one
 * station with one URL.
 *
 * Four kinds of evidence join routes. A TICON relay that declares its
 * originator (see sources/ticon/provenance.ts) joins the originator's route
 * when the two sit within MAX_PROVENANCE_KM and their M2 does not contradict
 * it; an unambiguous declaration skips the M2 check within MAX_GAUGE_CODE_KM.
 * A relay quality marks as superseded by its operator's record passed the same
 * tests, so its link counts as provenance. A CMEMS record joins the one
 * station of its name within MAX_COPY_KM whose M2, amplitude and phase,
 * agrees. Otherwise quality's `redundant` link
 * joins a duplicate to the record it duplicates: on a shared TICON gauge code,
 * or on proximity alone. Proximity pairs records to hide the weaker one, not
 * to say they are one gauge, so a confident plan leaves it, a gauge code
 * shared across more than MAX_GAUGE_CODE_KM, and a gauge code whose records'
 * M2 disagree, to a person. No link joins two authoritative records: two
 * station numbers a provider publishes stay two stations. Joined routes
 * collapse onto the published slug that names the primary record, so a clean
 * URL such as `bergen` survives even when an authoritative record took a
 * suffixed one.
 */
import type { DatabaseRoutes, StationQuality } from "@slackwater/database";
import { declaration } from "../../sources/ticon/provenance.ts";
import { tideConflict } from "./evaluate-quality.ts";
import {
  distance,
  gaugeKey,
  isAuthoritative,
  m2Contradicts,
  MAX_PROVENANCE_KM,
} from "./filtering.ts";
import { toSlug } from "./routes.ts";
import type { ResolvedStation } from "./metadata.ts";

/** The farthest a relay may sit from the originator it declares. */
export { MAX_PROVENANCE_KM };
/**
 * The farthest apart two records sharing a gauge code merge without review.
 * UHSLC's letter suffixes mark a gauge that moved, usually within its harbor;
 * farther apart, one record's position is likely wrong (Port Stanley's sit
 * 105.7 km apart).
 */
export const MAX_GAUGE_CODE_KM = 2;
/**
 * The farthest a CMEMS record may sit from the record it copies. CMEMS
 * relays European agencies' gauges under a code cut from the place name, so
 * it declares no originator; the same name at the same position is the
 * evidence instead.
 */
export const MAX_COPY_KM = 0.05;

export type Evidence = "provenance" | "copy" | "gauge" | "proximity";

export interface MergeMember {
  id: string;
  /** The slug this record's route published. */
  slug: string;
  name: string;
  /** Kilometres from the survivor's primary record. */
  km: number;
  /** How this record joined; absent for the survivor's own records. */
  evidence?: Evidence;
  /** The record the evidence points at. */
  target?: string;
}

export interface MergeGroup {
  /** The slug every other slug in the group redirects to: a published slug,
   *  or one a member already holds as a redirect, such as `cape-may`. */
  survivor: string;
  /** The record quality would choose to publish under it. */
  primary: string;
  /** Whether the primary comes from an authoritative source, whose geography the station takes. */
  authoritative: boolean;
  /** Every published slug in the group; the first's station file survives. */
  slugs: string[];
  members: MergeMember[];
}

export interface RefusedLink {
  id: string;
  target: string;
  reason: string;
}

export interface MergePlan {
  groups: MergeGroup[];
  /** Links that failed the position or M2 check, or would join two authoritative records. */
  refused: RefusedLink[];
}

const km = (a: ResolvedStation, b: ResolvedStation) =>
  distance(a.latitude, a.longitude, b.latitude, b.longitude);

/** A TICON record's gauge code; other sources have none. */
const gaugeCode = (station: ResolvedStation) =>
  station.id.startsWith("ticon/")
    ? gaugeKey(station.source?.id ?? station.id)
    : undefined;

type Tide = Parameters<typeof tideConflict>[0];

/** Whether two records' M2 disagrees in amplitude or phase by more than one
 *  gauge analyzed twice does, so a rule that joins on a code or a name
 *  refuses what the copy rule refuses. */
const m2Differs = (a: ResolvedStation, b: ResolvedStation) =>
  m2Contradicts(a, b) || !!tideConflict(a as Tide, b as Tide);

/**
 * A place name's spellings for matching: CMEMS writes Bodø as Bodoe and
 * Göteborg as Goteborg, so ø, ö, æ, ä, ü and å match either their bare letter
 * or their two-letter form. Digits stay, so "Galway Port 2" is not "Galway Port".
 */
function nameKeys(name: string): string[] {
  const key = (n: string) =>
    n
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]/g, "");
  const lower = name.toLowerCase();
  const keys = new Set([
    key(lower.replace(/ø/g, "o").replace(/æ/g, "ae")),
    key(
      lower
        .replace(/[øö]/g, "oe")
        .replace(/[æä]/g, "ae")
        .replace(/ü/g, "ue")
        .replace(/å/g, "aa"),
    ),
  ]);
  keys.delete("");
  return [...keys];
}

const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const shortestSlug = (a: string, b: string) =>
  a.length - b.length || byCodepoint(a, b);

/**
 * With `confident`, only provenance, CMEMS copies and gauge codes shared
 * within MAX_GAUGE_CODE_KM join routes: the merges `npm run merge` makes.
 */
export function planMerges(
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
  quality: Map<string, StationQuality>,
  { confident = false } = {},
): MergePlan {
  const byId = new Map(stations.map((station) => [station.id, station]));
  const slugOf = new Map<string, string>();
  for (const { slug, station_ids } of routes.tide)
    for (const id of station_ids) slugOf.set(id, slug);

  const parent = new Map<string, string>();
  const find = (slug: string): string => {
    const up = parent.get(slug) ?? slug;
    if (up === slug) return slug;
    const root = find(up);
    parent.set(slug, root);
    return root;
  };
  // The authoritative records under each root, so no link joins two.
  const authorities = new Map<string, string[]>();
  for (const { slug, station_ids } of routes.tide)
    authorities.set(
      slug,
      station_ids.filter((id) => {
        const station = byId.get(id);
        return station && isAuthoritative(station);
      }),
    );
  const evidence = new Map<string, { evidence: Evidence; target: string }>();
  const refused: RefusedLink[] = [];
  const join = (id: string, target: string, kind: Evidence) => {
    const [a, b] = [slugOf.get(id), slugOf.get(target)];
    if (!a || !b) return;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) {
      const [ia, ib] = [authorities.get(ra)!, authorities.get(rb)!];
      if (ia.length && ib.length) {
        // The gauge pass and quality's link can both try one pair.
        if (!refused.some((r) => r.id === id && r.target === target))
          refused.push({
            id,
            target,
            reason: `would join ${[...ia, ...ib].sort().join(" and ")}`,
          });
        return;
      }
      parent.set(ra, rb);
      authorities.set(rb, [...ia, ...ib]);
    }
    if (!evidence.has(id)) evidence.set(id, { evidence: kind, target });
  };

  for (const station of stations) {
    if (!station.id.startsWith("ticon/")) continue;
    const declared = declaration(station.id);
    const target = declared?.id;
    const origin = target ? byId.get(target) : undefined;
    if (!declared || !target || !origin) continue;
    const apart = km(station, origin);
    if (apart > MAX_PROVENANCE_KM)
      refused.push({
        id: station.id,
        target,
        reason: `${apart.toFixed(1)} km apart`,
      });
    // A number in the relay's own id, or a NOAA station number from NOAA,
    // names one gauge; M2 differs only where the two analyses span different
    // years (Wilmington's tide has grown with dredging) or the tide is a
    // centimetre (Grand Isle). Another provider's number may have no
    // namespace, and a relay farther off may name a renumbered gauge, so M2
    // confirms those.
    else if (
      !(declared.unambiguous && apart <= MAX_GAUGE_CODE_KM) &&
      m2Contradicts(station, origin)
    )
      refused.push({ id: station.id, target, reason: "M2 amplitudes differ" });
    else join(station.id, target, "provenance");
  }

  // A declared originator outranks an inferred duplicate: UHSLC 259B names
  // Ferry Reach even though quality pairs it with St George's 0.75 km away.
  // Quality supersedes a relay only under the tests above, so its link is
  // provenance too. Provenance links go first, then CMEMS copies, then gauge
  // links, then proximity ones, so a weaker link never takes the place of a
  // stronger one.
  const links = [...quality].flatMap(([id, result]) => {
    if (!result.redundant) return [];
    if (result.reason !== "duplicate" && result.reason !== "superseded")
      return [];
    if (evidence.get(id)?.evidence === "provenance") return [];
    const [station, target] = [byId.get(id), byId.get(result.redundant)];
    if (!station || !target) return [];
    // Quality points a superseded relay at the operator's record, unless
    // that record later lost a duplicate; the relay then follows the winner,
    // which only proximity may tie to it (Dauphin Island's relays point at
    // its Hydro gauge).
    const operator = result.issues
      ?.join(" ")
      .match(/Superseded by (\S+), its operator's own record/)?.[1];
    const code = gaugeCode(station);
    const kind: Evidence =
      result.reason === "superseded" && operator === result.redundant
        ? "provenance"
        : code && code === gaugeCode(target)
          ? "gauge"
          : "proximity";
    if (confident && kind === "proximity") return [];
    if (
      confident &&
      kind === "gauge" &&
      (km(station, target) > MAX_GAUGE_CODE_KM || m2Differs(station, target))
    )
      return [];
    return [{ id, target: result.redundant, kind }];
  });
  const joinAll = (kind: Evidence) => {
    for (const link of links)
      if (link.kind === kind) join(link.id, link.target, link.kind);
  };
  joinAll("provenance");

  // A CMEMS record joins the one station of its name it sits on, unless their
  // M2 says otherwise. Two such stations leave the choice to a person.
  // ponytail: every CMEMS record against every record; a spatial index if
  // this grows past seconds.
  const isCopy = (station: ResolvedStation) => station.id.endsWith("-cmems");
  for (const copy of stations.filter(isCopy)) {
    const names = nameKeys(copy.name ?? "");
    if (!names.length) continue;
    const named = stations.filter(
      (other) =>
        !isCopy(other) &&
        slugOf.has(other.id) &&
        km(copy, other) <= MAX_COPY_KM &&
        nameKeys(other.name ?? "").some((key) => names.includes(key)),
    );
    // Records already one station are one choice.
    const roots = new Set(named.map(({ id }) => find(slugOf.get(id) ?? id)));
    if (roots.size !== 1) continue;
    const other = named[0]!;
    // Records one route already holds are one station whatever M2 says.
    const rootOf = (id: string) => find(slugOf.get(id) ?? id);
    if (rootOf(copy.id) === rootOf(other.id)) continue;
    // Every record it would join must have an M2 that agrees with the copy's.
    const m2 = (station: ResolvedStation) =>
      station.harmonic_constituents?.some(({ name }) => name === "M2");
    if (!m2(copy) || !named.every(m2))
      refused.push({
        id: copy.id,
        target: other.id,
        reason: "no M2 to compare",
      });
    else if (named.some((n) => tideConflict(copy as Tide, n as Tide)))
      refused.push({ id: copy.id, target: other.id, reason: "M2 differs" });
    else join(copy.id, other.id, "copy");
  }
  // Records sharing a gauge code are segments of one gauge, whichever record
  // quality links each to, unless their M2 says otherwise (Fanning's 012a and
  // 012b sit together with M2 a factor of two apart).
  // ponytail: pairwise within a gauge code; codes hold a handful of records.
  const byGauge = new Map<string, ResolvedStation[]>();
  for (const station of stations) {
    const code = gaugeCode(station);
    if (!code) continue;
    const segments = byGauge.get(code) ?? [];
    for (const other of segments)
      if (km(station, other) <= MAX_GAUGE_CODE_KM && !m2Differs(station, other))
        join(station.id, other.id, "gauge");
    byGauge.set(code, [...segments, station]);
  }

  joinAll("gauge");
  joinAll("proximity");

  const slugsByRoot = new Map<string, string[]>();
  for (const { slug } of routes.tide) {
    const root = find(slug);
    slugsByRoot.set(root, [...(slugsByRoot.get(root) ?? []), slug]);
  }
  const idsBySlug = new Map(
    routes.tide.map(({ slug, station_ids }) => [slug, station_ids]),
  );
  const formerBySlug = new Map(
    routes.tide.map(({ slug, former_paths }) => [slug, former_paths ?? []]),
  );

  const groups: MergeGroup[] = [];
  for (const slugs of slugsByRoot.values()) {
    if (slugs.length < 2) continue;
    slugs.sort(shortestSlug);
    const ids = slugs.flatMap((slug) => idsBySlug.get(slug)!);
    const records = ids.flatMap((id) => byId.get(id) ?? []);
    const accepted = records.filter(({ id }) => quality.get(id)?.accepted);
    const primary =
      accepted.find(isAuthoritative) ??
      [...accepted].sort(
        (a, b) =>
          quality.get(b.id)!.score - quality.get(a.id)!.score ||
          byCodepoint(a.id, b.id),
      )[0] ??
      records[0]!;
    // The URL should name what the station shows, its primary record: the
    // shortest slug that is its name or a word-prefix of it (`annapolis` for
    // Annapolis US Naval Academy), else the primary's own slug, else the
    // shortest that is its name with a suffix. A slug a member holds as a
    // redirect counts, so Cape May takes back `cape-may`. A slug ending in a
    // record id is the ladder's last resort and loses to any other.
    const own = toSlug(primary.name ?? "");
    const primarySlug = slugOf.get(primary.id);
    const held = slugs.flatMap((slug) =>
      (formerBySlug.get(slug) ?? []).map((path) =>
        path.split("/").filter(Boolean).at(-1)!,
      ),
    );
    const rank = (slug: string) => [
      ids.some((id) => slug.endsWith(`-${toSlug(id)}`)) ? 1 : 0,
      slug === own || own.startsWith(`${slug}-`)
        ? 0
        : slug === primarySlug
          ? 1
          : slug.startsWith(`${own}-`)
            ? 2
            : 3,
      slug.length,
    ];
    const best = (candidates: string[]) =>
      [...candidates].sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        const i = ra.findIndex((value, index) => value !== rb[index]);
        return i >= 0 ? ra[i]! - rb[i]! : byCodepoint(a, b);
      })[0]!;
    const survivor = best([...slugs, ...held]);
    // The station file of the published slug the survivor is, or ranks best,
    // carries the merged station.
    const carrier = slugs.includes(survivor) ? survivor : best(slugs);
    slugs.splice(slugs.indexOf(carrier), 1);
    slugs.unshift(carrier);
    const members = records.map((record): MergeMember => {
      const joined = evidence.get(record.id);
      return {
        id: record.id,
        slug: slugOf.get(record.id)!,
        name: record.name ?? "",
        km: Number(km(record, primary).toFixed(3)),
        ...(joined ?? {}),
      };
    });
    groups.push({
      survivor,
      primary: primary.id,
      authoritative: isAuthoritative(primary),
      slugs,
      members,
    });
  }
  groups.sort((a, b) => byCodepoint(a.survivor, b.survivor));
  return { groups, refused };
}

/**
 * The merges `npm run merge` makes: every confident group, and each review
 * group whose surviving slug is named, which replaces the confident groups
 * within it. Throws before anything is written when a name matches no review
 * group or a station would be in two merges, since the plans can split a
 * gauge differently.
 */
export function selectMerges(
  confident: MergeGroup[],
  review: MergeGroup[],
  named: string[],
): MergeGroup[] {
  const picked = [...new Set(named)].map((slug) => {
    const group = review.find(({ survivor }) => survivor === slug);
    if (!group) throw new Error(`${slug}: no review group survives as it`);
    return group;
  });
  const within = (group: MergeGroup) =>
    picked.some(({ slugs }) =>
      group.slugs.every((slug) => slugs.includes(slug)),
    );
  const groups = [...confident.filter((group) => !within(group)), ...picked];
  const claimed = new Map<string, string>();
  for (const group of groups)
    for (const slug of group.slugs) {
      const other = claimed.get(slug);
      if (other)
        throw new Error(
          `${slug} is in the merges into ${other} and ${group.survivor}; merge one at a time`,
        );
      claimed.set(slug, group.survivor);
    }
  return groups;
}
