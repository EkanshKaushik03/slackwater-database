/**
 * Which tide routes publish the same physical gauge, and so should become one
 * station with one URL.
 *
 * Two kinds of evidence join routes. A TICON relay that declares its
 * originator (see sources/ticon/provenance.ts) joins the originator's route
 * when the two agree on position and M2. Otherwise quality's `redundant` link,
 * made by its proximity, gauge-key and harmonic checks, joins a duplicate to
 * the record it duplicates. Joined
 * routes collapse onto the shortest published slug, so a clean URL such as
 * `bergen` survives even when an authoritative record took a suffixed one.
 */
import type { DatabaseRoutes, StationQuality } from "@slackwater/database";
import { declaredOriginator } from "../../sources/ticon/provenance.ts";
import { distance, isAuthoritative, MIN_AMPLITUDE_RATIO } from "./filtering.ts";
import type { ResolvedStation } from "./metadata.ts";

/** The farthest a relay may sit from the originator it declares. */
export const MAX_PROVENANCE_KM = 10;
/** Members this close to the survivor, under its name, merge by rule alone. */
export const MECHANICAL_RADIUS_KM = 0.05;

export type Evidence = "duplicate" | "provenance";

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
  /** The slug every other slug in the group redirects to. */
  survivor: string;
  /** The record quality would choose to publish under it. */
  primary: string;
  /** Every published slug in the group, survivor first. */
  slugs: string[];
  members: MergeMember[];
  /** Same name and within MECHANICAL_RADIUS_KM, so the rule alone decides. */
  mechanical: boolean;
}

export interface RefusedLink {
  id: string;
  target: string;
  reason: string;
}

export interface MergePlan {
  groups: MergeGroup[];
  /** Groups left unmerged because they would join two published gauges. */
  conflicts: { slugs: string[]; authoritative: string[] }[];
  /** Declared originators that failed the position or M2 check. */
  refused: RefusedLink[];
}

const km = (a: ResolvedStation, b: ResolvedStation) =>
  distance(a.latitude, a.longitude, b.latitude, b.longitude);

const m2 = (station: ResolvedStation) =>
  station.harmonic_constituents?.find(({ name }) => name === "M2")?.amplitude;

function similarM2(a: ResolvedStation, b: ResolvedStation): boolean {
  const [ma, mb] = [m2(a), m2(b)];
  // A subordinate carries offsets, not constituents: position is the check.
  if (!ma || !mb) return true;
  return Math.min(ma, mb) / Math.max(ma, mb) >= MIN_AMPLITUDE_RATIO;
}

const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const shortestSlug = (a: string, b: string) =>
  a.length - b.length || byCodepoint(a, b);
const nameKey = (name: string) =>
  name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function planMerges(
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
  quality: Map<string, StationQuality>,
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
  const evidence = new Map<string, { evidence: Evidence; target: string }>();
  const join = (id: string, target: string, kind: Evidence) => {
    const [a, b] = [slugOf.get(id), slugOf.get(target)];
    if (!a || !b) return;
    evidence.set(id, { evidence: kind, target });
    if (find(a) !== find(b)) parent.set(find(a), find(b));
  };

  const refused: RefusedLink[] = [];
  for (const station of stations) {
    if (!station.id.startsWith("ticon/")) continue;
    const target = declaredOriginator(station.id);
    const origin = target ? byId.get(target) : undefined;
    if (!target || !origin) continue;
    const apart = km(station, origin);
    if (apart > MAX_PROVENANCE_KM)
      refused.push({
        id: station.id,
        target,
        reason: `${apart.toFixed(1)} km apart`,
      });
    else if (!similarM2(station, origin))
      refused.push({ id: station.id, target, reason: "M2 amplitudes differ" });
    else join(station.id, target, "provenance");
  }

  // A declared originator outranks an inferred duplicate: UHSLC 259B names
  // Ferry Reach even though quality pairs it with St George's 0.75 km away.
  for (const [id, result] of quality)
    if (result.reason === "duplicate" && result.redundant && !evidence.has(id))
      join(id, result.redundant, "duplicate");

  const slugsByRoot = new Map<string, string[]>();
  for (const { slug } of routes.tide) {
    const root = find(slug);
    slugsByRoot.set(root, [...(slugsByRoot.get(root) ?? []), slug]);
  }
  const idsBySlug = new Map(
    routes.tide.map(({ slug, station_ids }) => [slug, station_ids]),
  );

  const groups: MergeGroup[] = [];
  const conflicts: MergePlan["conflicts"] = [];
  for (const slugs of slugsByRoot.values()) {
    if (slugs.length < 2) continue;
    slugs.sort(shortestSlug);
    const ids = slugs.flatMap((slug) => idsBySlug.get(slug)!);
    const records = ids.flatMap((id) => byId.get(id) ?? []);
    const accepted = records.filter(({ id }) => quality.get(id)?.accepted);
    const authoritative = accepted.filter(isAuthoritative);
    // Two accepted authoritative records are two gauges a provider publishes
    // separately; joining them needs a person, not a chain of evidence.
    if (authoritative.length > 1) {
      conflicts.push({
        slugs,
        authoritative: authoritative.map(({ id }) => id),
      });
      continue;
    }
    const primary =
      authoritative[0] ??
      [...accepted].sort(
        (a, b) =>
          quality.get(b.id)!.score - quality.get(a.id)!.score ||
          byCodepoint(a.id, b.id),
      )[0] ??
      records[0]!;
    const survivor = slugs[0]!;
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
      slugs,
      members,
      mechanical: members.every(
        (member) =>
          member.km <= MECHANICAL_RADIUS_KM &&
          nameKey(member.name) === nameKey(primary.name ?? ""),
      ),
    });
  }
  groups.sort((a, b) => byCodepoint(a.survivor, b.survivor));
  return { groups, conflicts, refused };
}
