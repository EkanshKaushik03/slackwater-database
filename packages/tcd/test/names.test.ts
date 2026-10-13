import { describe, test, expect } from "vitest";
import type { Station } from "@slackwater/database";
import { buildStationNames, noteLines } from "../build.ts";

function station(fields: Partial<Station>): Station {
  return {
    id: "test/1",
    type: "subordinate",
    kind: "tide",
    source: { id: "1" },
    ...fields,
  } as Station;
}

describe("build_tide_db byte limits", () => {
  test("drops trailing name parts when multi-byte characters exceed 63 bytes", () => {
    // 43 characters but 68 bytes, so a character count would let it through
    const s = station({
      name: "ø".repeat(25),
      region: "Nordland",
      country: "Norway",
    });
    const name = buildStationNames([s]).get(s.id)!;
    expect(name).toBe(`${"ø".repeat(25)}, Nordland`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
  });

  test("wraps note lines by bytes", () => {
    // 179 characters but 299 bytes
    const disclaimers = Array(60).fill("©©").join(" ");
    const lines = noteLines(disclaimers);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(254);
      // build_tide_db files any other comment line under Comments
      expect(line).toMatch(/^# note: /);
    }
    expect(lines.map((l) => l.slice("# note: ".length)).join(" ")).toBe(
      disclaimers,
    );
  });
});
