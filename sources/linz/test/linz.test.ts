import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importDirectory, releaseUrl } from "../import.ts";
import {
  buildStation,
  parseHarmonics,
  resolveConstituent,
  siteId,
} from "../linz.ts";

const header = (latitude = "4117") => ` PICTON           Units in CM
 STATION 043 TIME ZONE = 180, LATITUDE = ${latitude}, LONGITUDE = 17400
 NUMBER OF VALID DATA =  8450  AVERAGE =152.83  STANDARD DEVIATION = 68.32
 THEORETICAL RMS =  8.56  MATRIX CONDITION =   .62
 ANALYSIS OF HOURLY TIDAL HEIGHTS  STN    43     1H 04/05/05 TO  23H 31/12/25
 NO.OBS.=  8783    NO.PTS.ANAL.=  8783    MIDPT= 0H 02/09/15  SEPARATION =1.00

  NO NAME    FREQUENCY   STN  M-Y/ M-Y      A       G
`;
const rows = `   1 Z0      .00000000   043 0505/1225  84.8195   0.00\r
  12 M2      .08051140   043 0505/1225  47.1656 245.18\r
  17 S2      .08333334   043 0505/1225  21.5391 326.92\r
`;

describe("LINZ harmonic files", () => {
  it("converts NZST phases to Greenwich and centimetres to metres", () => {
    const parsed = parseHarmonics(header() + rows, "043");
    expect(parsed).toMatchObject({
      name: "Picton",
      latitude: -41.283333,
      longitude: 174,
      z0: 0.848195,
      epoch: { start: "2005-05-04", end: "2025-12-31" },
    });
    // 245.18 − 28.984104 °/h × 12 h, wrapped.
    expect(parsed.constituents[0]).toEqual({
      name: "M2",
      amplitude: 0.471656,
      phase: 257.3708,
    });
    expect(parsed.constituents[1]).toEqual({
      name: "S2",
      amplitude: 0.215391,
      phase: 326.92,
    });
  });

  it("reads an amplitude that runs into the month-year field", () => {
    const wide = rows.replace(
      "043 0505/1225  84.8195",
      "148 0106/1219134.2423",
    );
    expect(parseHarmonics(header() + wide, "043").z0).toBe(1.342423);
  });

  it("repairs Nelson's misprinted latitude and rejects other bad positions", () => {
    const nelson = parseHarmonics(header("1416") + rows, "077");
    expect(nelson.latitude).toBe(-41.266667);
    expect(() => parseHarmonics(header("1416") + rows, "043")).toThrow(
      /outside New Zealand/,
    );
  });

  it("fails on a constituent row it cannot read", () => {
    const broken = rows.replace(
      "  17 S2      .08333334",
      "  17 S2      .0833x334",
    );
    expect(() => parseHarmonics(header() + broken, "043")).toThrow(
      /unreadable constituent row/,
    );
  });

  it("fails on an unnamed site, a missing Z0, or an unknown constituent", () => {
    expect(() => parseHarmonics(header() + rows, "999")).toThrow(
      /no display name/,
    );
    expect(() =>
      parseHarmonics(header() + rows.split("\n").slice(1).join("\n"), "043"),
    ).toThrow(/missing Z0/);
    expect(() => resolveConstituent("XX2", 28.1)).toThrow(/Unknown/);
  });

  it("maps LINZ names the catalogue spells differently", () => {
    expect(resolveConstituent("LDA2", 0.08182118 * 360)).toBe("lambda2");
    expect(resolveConstituent("H1", 0.08039733 * 360)).toBe("alpha2");
    expect(resolveConstituent("SA", 0.00011407 * 360)).toBe("Sa");
  });

  it("takes the site number from the file name", () => {
    expect(siteId("043PICTON_Harm_2005-2025.txt")).toBe("043");
    expect(siteId("58RIVERTON_Harm_2023-2025.txt")).toBe("058");
  });
});

describe("LINZ station records", () => {
  it("puts datums on LINZ chart datum with MSL at Z0", () => {
    const station = buildStation(parseHarmonics(header() + rows, "043"));
    expect(station).toMatchObject({
      country: "New Zealand",
      timezone: "Pacific/Auckland",
      chart_datum: "CD",
      datums_source: "harmonic",
      source: { id: "043", published_harmonics: true },
      license: { type: "cc-by-4.0", commercial_use: true },
    });
    expect(station.datums["CD"]).toBe(0);
    expect(station.datums["MSL"]).toBe(0.848);
    // M2 + S2 springs either side of MSL.
    expect(station.datums["MHWS"]).toBeCloseTo(0.848 + 0.687, 3);
  });
});

describe("LINZ import", () => {
  it("finds the release zip on the tide-constituents page", async () => {
    const page = `<a href="/sites/default/files/2026-08/NZ_Tide_Constituents_2025.zip">ZIP</a>`;
    expect(await releaseUrl(page)).toBe(
      "https://www.linz.govt.nz/sites/default/files/2026-08/NZ_Tide_Constituents_2025.zip",
    );
    await expect(releaseUrl("<p>no link</p>")).rejects.toThrow(/one/);
  });

  it("writes each site and removes stations LINZ no longer publishes", async () => {
    const root = await mkdtemp(join(tmpdir(), "linz-test-"));
    try {
      const release = join(root, "release");
      await mkdir(release);
      await writeFile(
        join(release, "043PICTON_Harm_2005-2025.txt"),
        header() + rows,
      );
      await mkdir(join(root, "data", "linz"), { recursive: true });
      await writeFile(join(root, "data", "linz", "999.json"), "{}");

      expect(await importDirectory(release, join(root, "data"))).toBe(1);
      expect(await readdir(join(root, "data", "linz"))).toEqual(["043.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
