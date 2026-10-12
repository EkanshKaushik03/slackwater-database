# LINZ source

Importer for the tide constituents published by Toitū Te Whenua Land Information New Zealand.

Tide constituents © Toitū Te Whenua Land Information New Zealand, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [LINZ tide constituents](https://www.linz.govt.nz/products-services/data/types-linz-data/sea-level-data/tide-constituents). Terms: [LINZ copyright](https://www.linz.govt.nz/copyright), which asks for attribution in writing and never by its logo or crest.

## Coverage

LINZ publishes one harmonic analysis per site, for gauges it describes as having at least three years of data, though several files cover only 2022–2023. All 56 sites in the 2025 release are in `data/linz/`, named by LINZ's site number (`043` is Picton). Major ports are re-analysed every year and the rest every three years.

## Updating

LINZ publishes each year's zip at a new URL. The import reads the current link from the tide-constituents page, downloads the release to `tmp/linz`, and writes `data/linz/`, removing any site LINZ no longer publishes. Pass a zip URL to import a specific release instead.

```sh
npm run import -w sources/linz
npm run evaluate-quality -w packages/stations
npm run metadata:lock
```

LINZ's CDN refuses requests without a browser-like User-Agent, which the import sends. LINZ squashes many place names (`WAIHOPAIRIVERENTRANCE`). The importer title-cases what LINZ prints, and `metadata/corrections.yaml` gives each squashed site the name LINZ's tide tables use, so a new site needs an entry there.

## Conversion

- Amplitudes are converted from centimetres to metres.
- Phases are referred to NZST (the header's `TIME ZONE = 180`, degrees east) and are moved to Greenwich with `G = g − speed × 12 h`. Checked against TICON's Wellington records, which agree to within about 2° on M2 and K1.
- `Z0` is LINZ's mean sea level above chart datum, the zero of its tide tables. MSL is set to it, and every other datum is derived from the constituents over the pinned datum epoch, then lifted by `Z0`. Chart datum is `CD`, as on New Zealand charts.
- Five LINZ names are mapped explicitly: `H1` → `alpha2`, `H2` → `M(KS)2`, `LDA2` → `lambda2`, `SIG1` → `sigma1`, `OQ2` → `OQ2_KV`. Every other constituent must match the catalogue by name and speed, or the import fails.

## Known issues upstream

- Positions are printed to the whole arcminute, so a station can sit a kilometre or two from its gauge. TICON's UHSLC copies of LINZ port gauges are dropped as duplicates where they fall within 500 m of the LINZ record, which covers most ports; at Bluff, Gisborne and Westport the two positions are rounded differently and both records ship. LINZ's tsunami-network gauges (TICON `ttw` records) and the Bureau of Meteorology gauge at Jackson Bay are separate instruments and are judged on their own.
- Nelson's header prints latitude `1416` for 41°16′S. The importer repairs it; any other position outside New Zealand fails the import.
- The `NUMBER OF VALID DATA`, `AVERAGE` and `NO.OBS.` header fields repeat the same values in every file, so the importer ignores them. The station number in the header sometimes disagrees with the file name (Green Island prints 254 in file 354); the file name is used.

## Validation

Against LINZ's own 2026 tide tables, high and low waters predicted from these records have a mean time error under 0.3 minutes and a mean height error under 2 mm at Picton, Wellington, Nelson and Auckland. The largest height error is 0.13 m, against tables printed to 0.1 m. The 95th-percentile time error is 5–11 minutes at Wellington, Auckland and Nelson and 21 minutes at Picton, where small neap tides turn slowly.

HAT, LAT and MSL agree with LINZ's [standard port tidal levels](https://www.linz.govt.nz/guidance/marine-information/tide-prediction-guidance/standard-port-tidal-levels) to within 0.05 m at all 16 standard ports. MHWS and MLWS do not: this database takes them as MSL ± (M2 + S2), while LINZ averages its predicted spring tides.
