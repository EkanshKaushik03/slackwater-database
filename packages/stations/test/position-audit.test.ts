import { describe, expect, test } from "vitest";
import { classifyPosition } from "../position-audit.ts";

const verified = {
  id: "noaa/9447659",
  latitude: 47.978,
  longitude: -122.223,
  positionVerified: true as const,
};
const clear = {
  id: "noaa/9449880",
  latitude: 48.546,
  longitude: -123.013,
};
const ashore = { id: "noaa/8", latitude: 48.515, longitude: -122.62 };

describe("position audit", () => {
  test("classifies clear, verified, ashore, and uncovered positions", () => {
    expect(classifyPosition(verified)).toEqual({ verdict: "verified" });
    expect(classifyPosition(clear)).toEqual({ verdict: "clear" });
    const result = classifyPosition(ashore);
    expect(result.verdict).toBe("ashore");
    if (result.verdict === "ashore")
      expect(result.metresInland).toBeGreaterThan(200);
    expect(
      classifyPosition({ id: "outside", latitude: 0, longitude: 0 }),
    ).toEqual({ verdict: "unverifiable" });
  });
});
