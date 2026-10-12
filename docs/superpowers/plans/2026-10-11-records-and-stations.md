# Records and stations

The catalogue treats each provider record as a station. Station identity — which records are the same physical gauge, which URL a place has, how it is named — is recovered by layers on top: quality dedup, `sameGauge` links, a history-dependent slug allocator, four slug and route lock files, an audit lock, and two curated YAML files. None of them answers on its own which stations are published, at what URL, with what name, or why.

This plan separates the two concepts. A **record** is what a provider published. A **station** is a place people see at a URL. A station has one or more records, and quality picks the primary one. Each station has one file, which holds its identity, its curated fields, and a build-written account of how every record in it was evaluated.

The goal is reviewability, not automation. Gauge identity across providers cannot be inferred reliably (see Matching), so the design makes it a one-line, reviewed edit, and makes every consequence of code or data changes visible as a station-file diff.

## Problems this solves

- **Authoritative sources land at suffixed URLs.** When Kartverket or LINZ lands, the TICON relay of the same gauge keeps the slug it published (`bergen`, `wellington`) and the authoritative record gets a suffixed one (`bergen-kartverket-bgo`). With stations, the authoritative record joins the existing station and becomes primary. The URL does not move.
- **One gauge, several pages.** 1,177 records quality marks as duplicates each have their own route, and relays outside the 500 m dedup radius (Bluff, Gisborne, Westport for LINZ; New London, Port San Luis, Monterey for NOAA) ship as separate accepted stations. With stations, they are records of one station, and the other URLs redirect.
- **Computed and curated duplicates behave differently.** Computed duplicates keep their own URL; curated `sameGauge` relays share their target's. With stations, both are records in one file.
- **No single place to look.** Acceptance is in `quality.json`, URLs in four lock files, display in two YAML files and `attribution.ts`. With stations, the station file answers all three.

## Layout

```
sources/<name>/metadata.yaml   # provider name, license, credit, authority
data/<source>/<id>.json      # provider records, importer-owned (unchanged)
metadata/                    # reference snapshots (unchanged)
stations/<kind>/<country>/<slug>.yaml   # one per station
stations/README.md           # curation policy, including the CHS gate survey
```

`data/` and `metadata/` keep their names: released databases link to `metadata/PROVENANCE.md`, and the website links to `data/<id>.json`. CHS identities (`sources/chs/stations.json`) and NOAA currents (`sources/noaa-current/currents.json`) remain record inputs where they are.

## Station files

```yaml
# stations/tide/nz/wellington.yaml
cities: [Lower Hutt, Porirua]
sources:
  - linz/071
  - ticon/wellington-071-nzl-uhslc_fd
  # UHSLC 071A: Data_Source LINZ, Originator_Number 071
  - ticon/wellington-071a-nzl-uhslc_rq
  - ticon/wellington-wlgt-nzl-ttw
redirect_from:
  - /tides/nz/wellington-wellington-region/
  - /tides/nz/wellington-ticon-wellington-wlgt-nzl-ttw/
  - /tides/nz/wellington-linz-071/

# Written by `npm run stations`. Do not edit.
computed:
  name: Wellington
  context: Wellington Harbour
  context_derived: true
  position: [-41.28472, 174.77944]
  coastline: clear
  primary: linz/071
  sources:
    linz/071: { status: accepted, score: 84 }
    ticon/wellington-071-nzl-uhslc_fd: { status: duplicate, score: 77 }
    ticon/wellington-071a-nzl-uhslc_rq:
      { status: rejected, reason: datum, score: 52, issues: ["MLLW above MSL"] }
    ticon/wellington-wlgt-nzl-ttw: { status: duplicate, score: 61 }
```

Station file properties are snake_case, matching provider records and the tcdb. A property exists only if code reads or validates it; evidence and explanation are YAML comments. Human-owned fields, above `computed`:

- `region`: the station's region code, used for both display and the URL's region segment. Absent when the path has none (3,195 tide paths). Stored, not derived from records. The country is the file's directory. Together they replace today's `location` overrides.
- `sources`: the provider records this station is built from, as record ids. Records this repo owns, such as CHS gates and reference ports (`chs-fulford-harbour`), are records like any other. Each record appears in exactly one station. A record the matcher added carries a comment naming the rule and distance until a human reviews it.
- `retired_sources`: records the provider no longer publishes, kept so their ids stay attached.
- `redirect_from`: every path this station has published and no longer uses, whether from a rename, a region or country change, or a merge. The tcdb emits them as the route's `former_paths`, so consumers redirect them.
- Display overrides, only where a curator sets them: `name`, `context`, `aliases`, `cities`, `position`, and `position_verified: true` for a published position the coastline audit flags but is correct. They apply to the station and every record in it.
- `status: retired` for a station that no longer publishes. Its slug and paths stay reserved and its route is not emitted.
- Records this repo owns (CHS gates and reference ports) are defined in their station file: `provider`, `tide_reference`, `magnitude_note` and `derived` (`reference`, `high_water_lag_minutes`, `low_water_lag_minutes`), named as the tcdb names them. The build reads their name and position from the station's overrides.

`computed` is build-owned. It records what the build concluded: resolved name, context and `context_derived`, position rounded to five decimals, coastline verdict, the primary record, and every record's quality status, reason, integer score and issues. Float factors are not committed; they ship in the tcdb.

A station has no id of its own. Its slug is its identity and its filename, unique per kind, and consumers resolve its data through the record ids in `sources`. Its URL is `/<kind>s/<country>/[<region>/]<slug>/`, from the file's directory, the `region` field and the filename. The tcdb route carries that path explicitly, so a record's geography changing cannot move a URL; it shows as a mismatch report instead. Changing a region edits one field. A rename or a country change is a `git mv`. Each adds a `redirect_from` entry.

## Build

- `npm run build` and `npm run generate` read station files and never write them. They fail when station files are stale.
- `npm run stations` evaluates quality, runs the matcher, and writes `computed` blocks and matcher additions. It is the only writer. It formats output with the options prettier accepts unchanged (`flowCollectionPadding: false`, `lineWidth: 0`), with a test that prettier leaves its output alone.
- `publish.yml` fails on a dirty tree.
- Quality evaluation is deterministic: the recency reference year is pinned in code, like `DATUM_EPOCH`. The coverage factor is computed over station primaries, so adding a record does not rescore unrelated stations.

## Matching

Gauge identity cannot be inferred reliably:

- Of 968 UHSLC relays in TICON, 310 fast-delivery records have no metadata. Of 658 research-quality records, 470 name an originator and 128 of those resolve to a record in this repo.
- `Originator_Number` has no namespace (`071` is Wellington and La Libertad), sometimes holds UHSLC's own code, and is absent for Massacre Bay, Westport, Auckland and every Norwegian relay.
- Gauge-key groups include different gauges (Bermuda 259A and 259B relay two NOAA stations 0.75 km apart; one Port Stanley group spans 106 km).
- Record ids churn: GESLA 4.1 replaced all 120 RWS ids.

So curated membership is the source of truth, and the matcher only auto-attaches when it is confident. Everything else it proposes.

`npm run stations` handles each unplaced record, scoped by kind, in a fixed order (authoritative sources first, then id by codepoint), with stations created earlier in the run as candidates:

1. **Rename map.** The importer emits old id → new id for records it can trace (TICON site code and position). A renamed record takes its predecessor's place, and the old id moves to `retired_sources`.
2. **Gauge key**, when every segment in the group agrees on originator and passes the harmonic similarity check. Auto-attaches.
3. **Proximity** within the dedup radius with today's harmonic checks. Auto-attaches when exactly one station matches. More than one match fails the run.
4. **Otherwise a new station.** The slug allocator runs only here, avoiding every slug and former slug of the same kind, in every directory.

After placement, the matcher writes a **proposal report** of likely same-gauge pairs that are in different stations: reviewed provenance links, proximity within 5 km with harmonic agreement, and records that name an existing record as originator (or are named by it). Provenance comes from a pinned extract under `sources/ticon` (code, Data_Source, Originator_Number, Last_Updated) refreshed by its own script, and from an allowlist mapping Data_Source patterns to sources here. A human accepts a proposal by moving record lines, with the evidence as a comment. A bot PR lists every auto-attachment and every new proposal in its body.

## Merging stations

Merging is how an authoritative record takes over relays' stations, and how duplicates collapse.

- The surviving path is the shortest slug among the merged stations, then the earliest published. The primary record is chosen separately. Bergen keeps `bergen`; Wellington keeps `wellington`.
- Every other station's path joins `redirect_from`, and its name joins `aliases`.
- The path is stored, so a merge across regions or countries keeps the survivor's path (Bermuda, Easter Island, Aguadilla).
- Chains resolve transitively: a duplicate of a duplicate joins the final station.
- A split moves records into a new station with a fresh slug, or back to a retired station, which may reclaim its own former path. No other station may take a path it never held.

## Primary selection

Among a station's accepted records, in order: a reference record over a subordinate (so Kodiak's UHSLC reference fit stays primary over a NOAA subordinate 2.25 km away), authoritative source, has accepted subordinates, score, coordinate precision, id. A station with no accepted record has no primary; its `computed` block names the reason from its best record, and name and position come from its overrides or its first record. The tcdb lists the primary first in the route's `station_ids`, and quality's `redundant` points at the primary.

## Checks

CI runs, on pull requests and through a merge queue so main is checked as merged:

- **Reproducible:** `npm run stations` on the committed inputs changes no station file.
- **Paths never vanish:** compared with the last release tag (fetched explicitly), no published path disappears unless it is in some station's `redirect_from` or belongs to a retired station, and no path moves to another station. A station that moves keeps its old path in `redirect_from`, which is how the check tells a move from a hand-off.
- **Consistency:** each slug is unique per kind across directories; each record belongs to exactly one station; every listed record exists in its source; every station's path matches the route path the tcdb emits.

## What a new source touches

- `sources/<name>/` with `metadata.yaml`, `data/<name>/`, and the explicit root test list.
- Station files it joins or creates. Adding LINZ updates about three stations per port it already has relays for and creates stations for the rest. The diff is more files than today but each hunk shows one station's decision.
- Station merges for the proposals a reviewer accepts.
- Shared edits when the source needs them: a provenance allowlist entry, the station schema for new record fields, a `LICENSE_NAMES` entry for a new license, a `countryLookup` name, an `updates.yml` job, coastline or water-body coverage for a new region, and the README credits list.

## Constraints

- Published slugs depend on history, so they are stored and never recomputed.
- `attribution.ts` ships in browser and worker bundles. It stays pure; the Node build resolves `metadata.yaml` and passes the credit in. `attributionFor` and `LICENSE_NAMES` keep their public signatures.
- Root tests stay an explicit list, so `npm test` needs neither Docker nor Swift.
- Station records keep `license` and `disclaimers`.
- Consumers read routes from the tcdb. slackwater.xyz uses `stationIds`, `formerPaths`, `context_derived` and `quality.seasonal_dominant`; the route schema gains `path`, and Swift is regenerated.
- `sources/chs/import.ts` reads station files for every CHS record id that has been in a station and for CHS tide-port positions.

## Migration

Each step ships on its own and leaves the published database unchanged unless it says otherwise. Counts below were taken before LINZ merged; the step 3 report gives current ones.

### 1. Deterministic quality

Pin the recency year. Regenerate `quality.json` on main. Sort by codepoint. Check: a fake clock a year ahead changes no outcome.

### 2. `metadata.yaml`

One per provider, read by the Node loaders where each creates inputs. Replaces `SOURCE_CREDITS` and the prefix list in `isDirectAuthoritativeProvider`. A test requires a `metadata.yaml` with `credit` for every loaded source, with `name` equal to each record's `source.name`. Check: the tcdb is byte-identical.

### 3. Provenance extract and proposal report

Commit the pinned UHSLC extract and the allowlist. Produce the proposal report against today's catalogue. This publishes nothing; it is the review queue for the merges in step 4.

### 4. Station files

One PR creates the station files with merges already applied, so a duplicate station never gets a file of its own.

- Generate one file per route. `sources` are the route's station ids, registry ids included; registry gate fields go on the station. Overrides come only from today's corrections and registry. `redirect_from` comes from `routes.lock.json` former paths. `computed` comes from today's resolution and `quality.json`.
- Fields from `corrections.yaml` and `registry.yaml` map onto the station file:

  | Today                                                            | Station file                                                                    |
  | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | `name`, `context`, `aliases`, `cities`                           | same names                                                                      |
  | `position`                                                       | `position`                                                                      |
  | `reason`, registry `source`                                      | YAML comments                                                                   |
  | `positionVerified` (text)                                        | `position_verified: true`, with the text as a comment                           |
  | `location.countryCode`, `location.regionCode`                    | the file's directory and `region`                                               |
  | `slug`                                                           | the filename                                                                    |
  | `formerSlugs`                                                    | `redirect_from` paths                                                           |
  | `sameGauge`                                                      | membership in `sources`                                                         |
  | registry `kind`                                                  | the `stations/<kind>/` directory                                                |
  | registry `provider`, `tideReference`, `magnitudeNote`, `derived` | `provider`, `tide_reference`, `magnitude_note`, `derived` with tcdb field names |

  A route whose records carry conflicting corrections (the 16 routes with more than one record) fails generation until a curator picks one value.

- Merge while generating:
  - Authoritative takeovers: TICON relays join their Kartverket, LINZ or NOAA station, from accepted proposals. This includes the 567 records quality marks superseded and the 59 NOAA provenance links outside the dedup radius.
  - Computed duplicates: the 1,177 records quality marks duplicate join their winner's station.
  - Each merge follows the merging rules: the shortest published slug survives, other paths join `redirect_from`, other names join `aliases`.
- A merge report lists every merge in two groups. Mechanical merges (same name, within 50 m) are reviewed by rule and a sample. The rest (unrelated names, cross-region or cross-country, chains through rejected records) are listed one per line with their evidence.
- Add `path` to the route schema. The build reads station files instead of `slugs.json`, `routes.lock.json`, `former-slugs.json`, `slug-tombstones.json`, `audit.lock.json`, `corrections.yaml` and `registry.yaml`, which are deleted. Curation policy moves to `stations/README.md`.
- Turn on the path and consistency checks.
- Check: the generator's no-merge mode reproduces every tcdb field other than the new route `path`, byte for byte. With merges, the only tcdb changes are routes collapsing into their survivors, with every old path in `former_paths`.
- About 1,200 pages become redirects on slackwater.xyz.

### 5. `npm run stations`

Quality runs inside it, writes `computed`, and `quality.json` is deleted. The matcher handles new records. The reproducible check turns on. Check: on unchanged records, it changes no station file.

## Open questions

- Whether CHS identity-only stations (138 within 500 m of a provider record) merge with those records. CHS has no harmonics, so the matcher cannot check them.
- Whether score is worth committing, given that a weight change rewrites most `computed` blocks.
