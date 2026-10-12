# Stations

Every published station has one file here, at `stations/<kind>/<country>/<slug>.yaml`. The file is the station's URL: `stations/tide/us/everett.yaml` publishes `/tides/us/wa/everett/`, taking the region segment from its `region` field. A file lists the provider records the station is built from, anything curated about it, and a `computed` block that `npm run stations` writes.

```yaml
name: Everett
region: US-WA
aliases: [port gardner, everett marina]
cities: [Everett, Marysville]
sources:
  - noaa/9447659
# Written by `npm run stations`. Do not edit.
computed:
  sources:
    noaa/9447659:
      position: [47.98, -122.223]
      coastline: clear
      quality:
        accepted: true
        score: 84
        factors:
          epoch: 1
          recency: 0.75
          source: 1
          quality: 1
          amplitude: 1
          coverage: 0.122
```

Evidence and explanations are YAML comments. A field exists only when code reads or validates it.

## Fields

- `sources`: the record ids the station publishes, as the database's route `station_ids`. A record belongs to exactly one station.
- `retired_sources`: records the provider no longer publishes, or that are no longer routed (a NOAA current that loses its flood or ebb direction). `npm run stations` moves a vanished record here, and back to `sources` if the provider publishes it again. A station whose every record is retired keeps its file and publishes no route, so its paths answer 404 but stay reserved for its water. More than ten records retiring in one run is more often a broken import, so `npm run stations` refuses it unless run as `STATIONS_RETIRE=1 npm run stations`.
- `redirect_from`: every path the station published and no longer uses. The database ships them as the route's `former_paths`, so consumers redirect them.
- `region`: the ISO 3166-2 code of the URL's region segment, absent when the path has none. The country is the file's directory. Every record in the station takes both, so a change in derived geography cannot move a URL. A CHS station is filed under `ca/` (Saint-Pierre under `pm/`); `validate:database` refuses one anywhere else.
- `name`, `context`, `aliases`, `cities`, `position`: curated display fields. They apply to every record in the station, except in a station this repo owns (below), where they define the owned record.
- `position_verified: true`: the published position is right although the coastline audit puts it ashore, as for a gauge sited up a river.
- `provider`, `tide_reference`, `magnitude_note`, `derived`: a station this repo owns (below).
- `computed`: each record's position, coastline verdict and, for a provider tide record, its quality evaluation: whether it is accepted, why not, which record it duplicates, its score and the factors behind it. A change here in a pull request is a station that moved or a change in how it was judged.

## Changing a station

- **Rename or move.** `git mv` the file and add the old path to `redirect_from`. A published path never disappears and never changes hands.
- **Same gauge, several records.** Move the record line into the station that publishes the gauge, add the absorbed station's path to `redirect_from`, and delete its file. Say why in a comment, citing the station documentation; matching names or nearby positions alone do not establish gauge identity.
- **New records.** `npm run stations` gives each record no station lists a station of its own, with a slug no station or redirect holds.
- **New relays of a gauge already published.** `npm run merge-report -w packages/stations` lists the stations that publish the same gauge: a relay that declares its originator (see [sources/ticon/provenance.ts](../sources/ticon/provenance.ts)), or a record quality marks as a duplicate. `-- --apply` folds each group into one station, which keeps the slug that names its primary record, takes that record's country when its source is authoritative, and keeps only the curated fields of the station that held it. Review the report's non-mechanical merges, the curated fields it drops, and any country a station takes.

Run from the repo root after any change:

```shell
npm run stations
npm run validate:database
```

`validate:database` fails when any station file is not what `npm run stations` would write. With `PUBLISHED_REF` set, it also fails when a path that ref publishes no longer resolves, or now belongs to a station that shares none of its records; CI sets it to the base branch on a pull request and to the last release before publishing:

```shell
PUBLISHED_REF=origin/main npm run validate:database
```

## Curation rules

`context` is whatever most usefully distinguishes this place: a water body, an island group, a region, a county, or a characteristic. It must never restate the name. Without one, a station takes the qualifier in its provider name, then the OpenStreetMap bay or strait it sits in, then the nearest place. Curate `context` only where that answer is wrong or less useful.

`cleanName` undoes a provider's formatting and nothing more. A spelling that takes knowing the place is a `name` here, so that one station's spelling can never change another's. `npm run validate:database` reports the curated names the cleanup already produces, which is the list to prune when a provider catches up.

A redirect is for a path that named the _same place_: a rename qualifies, a mislabel does not, since redirecting a mislabel preserves a wrong link where a 404 is more honest (issue #6, the retired `anacortes`).

## Stations this repo owns

A station with a `provider` holds a record this repo owns rather than corrects: the one source no provider supplies, such as `chs-victoria`. Its name is not a provider's name and its position is not a correction of a published one. CHS tidal-current gates are data like this: the fitting pipeline emits a hand-written label and no position at all. Owned ids match what chs-constituents emits ("chs-" plus the slug of the label), so a consumer can resolve straight from the id in its own output.

These are this project's own facts, not a copy of a provider's station file. Names and contexts are hand-written; positions are independently derived from the chs-constituents fitting pipeline and currents-vault pass frontmatter, and agree with chs-constituents/stations/salish-sea.json. Owned stations ship no provider-minted identifiers; those live only in each operator's local, licence-covered pipeline (see [PROVENANCE.md](../metadata/PROVENANCE.md)). Every one is human-reviewed before it lands. A station whose facts came from somewhere else says where in a comment, as Boundary Pass does.

An owned station may also list provider records for the same water, as `victoria` lists the UHSLC relay: one page with the curated name and the provider's harmonics, rather than two pages a few hundred metres apart that neither holds the bare slug.

There are two bounded, hand-curated classes, told apart by kind:

- **Current gates** (`stations/current/`). A current station joins when safe transit requires timing slack: the gates on the Inside Passage route, not every interesting current.
- **Tide reference ports** (`stations/tide/`). A tide station joins when CHS itself designates it a reference port, an external rule this project did not invent. Probing the 47–51.5N, 126.5–122W box found exactly ten (chs-online design spec §6b). Positions are from CHS's public prediction-station list, matched by position and confirmed in water by the coastline audit, not the fitting pipeline that supplies the current gates. Display names are shortened where safe (the resolver keys on position, not name), contexts never restate the name, and aliases are what a local would type.

Both rules are expansion-friendly and rule-governed; neither is a cap. A consumer picks the right CHS series (currents or tides) by a station's kind.

Boundary Pass is not CHS: it is a NOAA current station, carried here because currents-vault, which curates the same gates, takes station identity from this repo.

### Paired tide ports

A fitted current gate (one with its own CHS current predictions) may carry a `tide_reference`: the owned tide port whose water a paired tide and current view shows beside it. The `tide_reference` is the _nearest_ tide reference port in the same tidal regime, chosen by position, not guessed. The two a mariner would double-check both match published secondary-reference practice: Seymour Narrows to Campbell River, and Sechelt Rapids (Skookumchuck) to Point Atkinson (Ports and Passes, Waggoner). A gate with no honestly near reference port carries none: unpaired beats a wrong pairing.

### Derived gates

A current gate CHS publishes no current station for carries a `derived` block: its slack is derived from a reference tide port's high and low water plus a fixed lag. `derived.reference` is that tide port; `high_water_lag_minutes` and `low_water_lag_minutes` are the minutes after its HW and LW that slack occurs. The pass floods on the rising tide and ebbs on the falling one, so a consumer states slack times and a flood or ebb phase, but never a speed: CHS predicts none. A derived gate carries only the reference and the two lags, and is mutually exclusive with `tide_reference`, which is a display companion where `derived` is the source of slack.

Whether an admitted gate's slack can be _predicted_ is a separate question, asked downstream and answered against published events: Nakwakto is a real gate that no harmonic model fits (see openwatersio/slackwater-ios#9).

### The rest of Canada

CHS publishes tidal currents at exactly 30 stations nationally, and twenty are here. This survey records how the gate rule decided the stations outside the Inside Passage, so the next person does not re-run it, and so nobody "discovers" a missing station and adds it back without the reason.

**Admitted:** Nakwakto Rapids, Quatsino Narrows, Masset Sound, Great Bras d'Or. Each has a published instruction to transit on slack.

**Rejected**, because a current station exists but nothing times a transit on it:

| Station               | Why                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scott Channel         | Sailing Directions: "deep and free of dangers". Tide rips on a headland rounding, not a gate. Cruisers round Cape Scott on Nahwitti Bar's slack instead.                                                                                                                                                                                                                        |
| Hiekish Narrows       | No slack caution in PAC 205, and it is the optional east branch: Tolmie Channel is the Inner Passage route. VTS only asks you to advise if transiting.                                                                                                                                                                                                                          |
| Grand Manan Channel   | ATL 106: "no dangers in the fairway". Also discontinued as a station. Head Harbour Passage nearby does run to 5 kn, but CHS predicts no current there, so there is nothing to admit.                                                                                                                                                                                            |
| Abegweit Passage      | 2.0 kn under the Confederation Bridge, across 5.5 miles of navigable width. ATL 108 gives no stream rate and no slack advice at all. The widely copied "4 knots" is Wikipedia, roughly double CHS.                                                                                                                                                                              |
| Fairview Terminal     | A container berth on Kaien Island. A temporary station feeding Prince Rupert's pilotage instrumentation: berthing data, not a passage.                                                                                                                                                                                                                                          |
| Porpoise Channel East | The near miss, and the one worth reading before re-adding it. There is a published HW-slack rule for Porpoise Harbour, and Pub 154 does say 6–7 kn, but that is an under-keel-clearance window for loaded ships at the Ridley-Lelu narrows, and this station sits east of that pinch, where CHS predicts 2.0 kn. A gate whose station is not on the gate is worse than no gate. |
