# Contributing

The project layout, local setup, the checks CI runs, how a release is cut, and the traps that have cost someone real time.

See the org-wide [writing style](https://github.com/openwatersio/github/blob/main/docs/agents/writing-style.md) for prose in commits, pull requests, issues, and docs.

## Layout

- `packages/database` — the published `@slackwater/database` package and the FlatBuffers builder. Its format is documented in [docs/database-format.md](docs/database-format.md).
- `packages/stations` — station identity, quality evaluation, and the station-file writer.
- `packages/datums` — datum derivation and the ordering gate.
- `packages/harmonic-analysis` — constituent fitting.
- `packages/tcd` — the XTide-compatible TCD writer.
- `packages/swift` — the generated Swift reader. The generated sources are committed, because SwiftPM consumers cannot run `flatc`.
- `sources/*` — one directory per upstream provider: `chs`, `kartverket`, `linz`, `noaa`, `noaa-current`, `rws`, `ticon`.
- `stations/` — one file per published station: its records, URL, redirects and curated fields. See [stations/README.md](stations/README.md).
- `data/`, `metadata/`, `schemas/` — downloaded source data, reviewed reference snapshots, and the FlatBuffers schemas.

## Getting started

```sh
npm ci
npm run check
```

`.mise.toml` pins Node 24, npm 11.19.0 and `flatc` 25.9.23; CI selects the same Node with `actions/setup-node` and gets `flatc` from `jdx/mise-action`. A fresh checkout or worktree needs `mise trust` before anything builds, or `pretest` dies with `spawnSync flatc ENOENT`.

## Commands

From the repo root:

| Command                              | Does                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                      | Lint, test and validate, which CI runs. Run it before pushing; set `PUBLISHED_REF=origin/main` to add CI's published-URL check. |
| `npm run build`                      | Generate the database and build `@slackwater/database`                                                                          |
| `npm test`                           | Build, typecheck, then run every workspace's `test` script                                                                      |
| `npm run stations`                   | Evaluate quality and rewrite the [station files](stations/README.md) after a code or data change                                |
| `npm run merge -w packages/stations` | Fold the stations that publish one gauge into one, as `report:merges` lists them                                                |
| `npm run validate`                   | Fail on any station file `npm run stations` would change; `PUBLISHED_REF=<ref>` also checks published URLs against that ref     |
| `npm run lint` / `npm run format`    | Prettier check / write                                                                                                          |

Each workspace uses the same verbs, run with `-w <workspace>`:

| Verb                        | Means                                                                                                              | Where                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import`                    | Pull a source's data into `data/`                                                                                  | `sources/noaa`, `noaa-current`, `ticon`, `kartverket`, `linz`, `chs`                                                                                                                                                                                                                                                   |
| `refresh:<name>`            | Refresh a pinned snapshot or fixture; review the diff before committing                                            | `refresh:places`, `refresh:water-bodies`, `refresh:maritime-zones`, `refresh:lat-hat` (`packages/stations`), `refresh:sea-regions` (`packages/datums`), `refresh:uhslc` (`sources/ticon`), `refresh:lock`, `refresh:golden` (`sources/noaa-current`), `refresh:fixtures`, `refresh:tide-tables` (`sources/kartverket`) |
| `report:<name>`             | Diagnostics that change nothing                                                                                    | `report:quality`, `report:merges`, `report:lat-hat`, `report:ticon-datums` (`packages/stations`), `report:score-line` (`packages/harmonic-analysis`), `report:drift` (`sources/noaa-current`)                                                                                                                          |
| `validate`                  | Check a source's data against its publisher's predictions (`kartverket`, `rws`) or its own schema (`noaa-current`) | `sources/kartverket`, `sources/rws`, `sources/noaa-current`                                                                                                                                                                                                                                                            |
| `test:docker`, `test:swift` | Tests that need Docker or a Swift toolchain, run in their own CI jobs                                              | `packages/tcd`, `packages/swift`                                                                                                                                                                                                                                                                                       |

`npm test` **does** include the type gate: it is `npm run build -w packages/database && tsc -p tsconfig.node.json && …`. There is no root `tsconfig.json`, so `npx tsc -p tsconfig.json --noEmit` fails with TS5058 — name `tsconfig.node.json` explicitly. It inherits `exactOptionalPropertyTypes` from `tsconfig.base.json`, so assigning a possibly-undefined value into an optional field is an error; spread it conditionally instead.

If `npm run validate` reports that station files are stale, run `npm run stations`, review the station-file diff, and commit it.

The Swift job additionally regenerates the committed Swift and fails on drift:

```sh
npm run generate -w swift && git diff --exit-code -- packages/swift/Sources
```

## Releases

A release is cut entirely by dispatching the workflow. Nothing is tagged or versioned by hand:

```sh
gh workflow run publish.yml --ref main
```

`packages/database/package.json` holds a **floor** version such as `1.0.0-beta.0`. The workflow replaces its last segment with today's date to derive `1.0.0-beta.20260926`, publishes to npm, then tags and creates the GitHub release with the `.tcd` and `.tcdb` assets. The `exact` input exists only for the first stable `X.Y.0`.

GitHub's generated release notes are this repository's established style; releases since v0.8 use them. Don't replace them with curated notes without asking — other Open Waters repos differ here.

Three things that look like failures and are not:

- The npm registry can take about two minutes to show a new version after the publish step succeeds.
- `npm view` reports stale dist-tags during that window.
- npm's `latest` tag sits on the `1.0.0-beta.0` floor. The publish step adds `--tag beta` only when the version contains a `-`, so the first stable `1.0.0` will move `latest` by npm's own default. Install `@slackwater/database@beta` until then. This was filed once and closed as not planned (#206).

Verify a release against the registry rather than the run log, since the publish step passes before npm has propagated. Install `@slackwater/database@beta` into a scratch directory and read the affected stations back.

A release is not finished until both consumers pin it. Bump [slackwater-ios](https://github.com/openwatersio/slackwater-ios) and [slackwater.xyz](https://github.com/openwatersio/slackwater.xyz) to the same version in the same pass, so the app and the site name, place, and credit every station alike. slackwater-ios pins it twice, in `tools/package.json` and as the `SlackwaterDatabase` `exactVersion` in `project.yml`, and regenerates its bundle with `cd tools && npm run build:data`.

## Gotchas

**The repo was renamed.** `openwatersio/tide-database` redirects to `openwatersio/slackwater-database`, so an old clone's `origin` keeps working and `gh` resolves through the redirect without saying so. A local checkout directory named `tide-database` is the same repo.

**Build-time lookups are not an indexing problem.** Every boundary lookup runs while the database builds — the iOS app does none — and over ~11k stations they were measured at 187 ms for water bodies, 268 ms for maritime zones, and ~135 ms to load the GeoJSON. There is nothing there for a spatial index to save, so don't reach for FlatGeobuf or an R-tree. When one of these is slow it is algorithmic: the Baltic chart-datum check took 2–6 s because it had no bounding-box test, and adding one (#214) took it to ~20 ms with a byte-identical `.tcdb`. Look for a missing bbox prefilter first.

The coastline audit (`position-audit.ts`, ~3 s) is dominated by 98 onshore stations running ~1,150 spiral probes each. A nearest-segment distance would fix it, but it shifts `metresInland` and every station file's `computed` block would change, so it is left alone deliberately.
