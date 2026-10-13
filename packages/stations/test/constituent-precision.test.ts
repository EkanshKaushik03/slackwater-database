import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";
import {
  DATA_DIR,
  PUBLISHED_PRECISION,
  roundConstituents,
} from "../station.js";

const isRounded = (n: number, digits: number) =>
  Number(n.toFixed(digits)) === n;

const sources = readdirSync(DATA_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// Each source keeps the precision it publishes. Anything finer is float noise
// from our conversions to metres and UTC.
describe.each(sources)("data/%s constituents", (source) => {
  test("keep the published precision", () => {
    const precision = PUBLISHED_PRECISION[source];
    expect(precision, `declare ${source} in PUBLISHED_PRECISION`).toBeDefined();
    const files = readdirSync(join(DATA_DIR, source));
    expect(files.length).toBeGreaterThan(0);
    const unrounded: string[] = [];
    for (const file of files) {
      const { harmonic_constituents = [] } = JSON.parse(
        readFileSync(join(DATA_DIR, source, file), "utf-8"),
      );
      for (const { name, amplitude, phase } of harmonic_constituents) {
        if (
          !isRounded(amplitude, precision!.amplitude) ||
          !isRounded(phase, precision!.phase)
        ) {
          unrounded.push(`${file} ${name}: ${amplitude} ${phase}`);
        }
      }
    }
    expect(unrounded).toEqual([]);
  });
});

describe("roundConstituents", () => {
  test("strips conversion noise", () => {
    expect(
      roundConstituents("ticon", [
        {
          name: "M2",
          amplitude: 0.27384021000000003,
          phase: 131.04180299999996,
        },
      ]),
    ).toEqual([{ name: "M2", amplitude: 0.27384021, phase: 131.041803 }]);
  });

  test("keeps a phase as the source publishes it", () => {
    // NOAA publishes SA at Neah Bay as 684°.
    expect(
      roundConstituents("noaa", [{ name: "SA", amplitude: 0.122, phase: 684 }]),
    ).toEqual([{ name: "SA", amplitude: 0.122, phase: 684 }]);
  });

  test("refuses a source with no declared precision", () => {
    expect(() => roundConstituents("unknown", [])).toThrow(/unknown/);
  });
});
