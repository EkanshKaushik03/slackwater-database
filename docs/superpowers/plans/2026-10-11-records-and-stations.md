# Records and stations

A **record** is what a provider published: a file under `data/`, a CHS identity in `sources/chs/stations.json`, a NOAA current in `sources/noaa-current/currents.json`. A **station** is a place people see at a URL. A station has one or more records, and each published station is one file under `stations/`, which holds its records, its URL and redirects, anything curated about it, and a `computed` block with each record's position, coastline verdict and quality evaluation. [stations/README.md](../../../stations/README.md) is the reference for the format and the curation rules.

The goal is reviewability, not automation. Gauge identity across providers cannot be inferred reliably, so the design makes it a reviewed edit to station files, and makes every consequence of a code or data change visible as a station-file diff.

## Design

- **Source metadata.** `sources/<name>/metadata.yaml` declares each provider's name, credit and authority. The Node loaders look a record's source up by `source.name`; `attribution.ts` takes the resolved credit, since it ships in browser and worker bundles. `buildDatabase` requires a credit decision for every source it writes.
- **Slugs.** A station's slug is its file name, stored once and never recomputed. Only a record no station lists climbs the slug ladder, past every slug and redirect already published.
- **Geography.** Every record in a station takes the station's country (its directory) and region (its `region` field, or none), so derived geography cannot move a URL.
- **Quality.** `npm run stations` evaluates quality, in record-id order so the result does not depend on the filesystem, and writes it into each station file. The build reads it back. The recency reference year is pinned to `DATUM_EPOCH`.
- **Retirement.** A record the provider stops publishing moves to `retired_sources` and returns if it comes back. A station with no live records keeps its file and its paths. More than ten records retiring in one run needs `STATIONS_RETIRE=1`.
- **Merging.** `npm run merge-report -w packages/stations` groups the stations that publish one gauge: a TICON relay that declares its originator (`sources/ticon/provenance.ts`, with a pinned UHSLC extract) after position and M2 checks, else a record quality marks as a duplicate. `-- --apply` folds each group into one station. The survivor is the slug that names the primary record, else the primary's own slug, else the shortest slug that starts with the primary's name, else the shortest; a slug ending in a record id loses to any other. The station takes the primary's geography when its source is authoritative, and the curated fields of the station that held the primary. A group joining two authoritative records is left for a person.
- **Checks.** `validate:database` fails on any station file `npm run stations` would change, a CHS station filed outside Canada or Saint-Pierre, and, with `PUBLISHED_REF` set, a published path that no longer resolves or now names other water. CI sets `PUBLISHED_REF` to the base branch on a pull request and to the last release before publishing. `readStationFiles` refuses misfiled files, a record in two stations, a redirect two stations hold, and a slug another station redirects from.

## Next

Station files map one to one onto the routes the database published before them; no station has been merged yet.

- **Merging gauges.** `merge-report` groups 1,601 records into 1,210 stations, on three kinds of evidence of very different strength:

  | Evidence                                          | Records | Confidence                                                                                                                                                                              |
  | ------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Provenance: the relay names the station it copies | 564     | High                                                                                                                                                                                    |
  | Same TICON gauge code: segments of one gauge      | 382     | High, but a few pairs sit tens of km apart (Port Stanley 105.7 km), which means a bad coordinate                                                                                        |
  | Proximity only: quality's dedup rule              | 657     | Low to moderate. Quality pairs records to hide the weaker one, not to assert one gauge: it pairs Oakland's Grove Street subordinate with Oakland Inner Harbor, whose predictions differ |

  Merge the high-confidence groups with a distance cap, list the rest for a person, and decide the six groups that would join two NOAA station numbers (Panama City and Courtney Point, Dauphin Island, Eugene Island, Little Torch Key, Oakland Inner Harbor, Saxis). Merging gives Kartverket's, LINZ's and NOAA's records the clean URLs their relays hold (`bergen`, `wellington`). This closes #275. Add a provenance rule for TICON's Kartverket relays first: an `nhs` relay carries the Kartverket station code in its id (`ticon/bergen-bgo-nor-nhs` relays `kartverket/BGO`), as a `-noaa` relay carries its NOAA number. `--apply` keeps file-level comments but drops comments beside an absorbed station's records and redirects; carry them into the survivor before merging by rule.

- **Quality evaluation.** [docs/quality-evaluation.md](../../quality-evaluation.md) describes each rule. Changes to review, each a change in which records are accepted:
  - Whether proximity alone should mark a duplicate, in particular a subordinate beside a reference whose predictions differ (Oakland Grove Street and Oakland Inner Harbor).
  - Capping gauge-key collapse by distance (Port Stanley's segments sit 105.7 km apart).
  - A record rejected as a duplicate goes on rejecting later records in its own favor, so 83 `redundant` links point at a rejected record.
  - UHSLC fast-delivery records rank above research-quality ones.
  - A TICON relay of a NOAA gauge with no direct NOAA harmonics scores as an authoritative source.
  - Only NOAA relays are superseded; relays of Kartverket and LINZ gauges are caught only within the proximity limits.
  - Coverage counts rejected records and same-gauge twins as neighbors.
  - Only the first gate failure is recorded.
  - The P1 > K1 check calls millimetre-level noise physically impossible; authoritative sources are exempt without saying why.
- **Matching new records.** A new authoritative record lands at a suffixed slug beside its relay's station until someone runs `merge-report --apply`. Merging stays a reviewed, manual step.
- **CHS identity stations.** 138 sit within 500 m of a provider record. They carry no harmonics, so they cannot be checked against it, and they stay separate.
