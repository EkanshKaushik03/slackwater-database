import { expect, test } from "vitest";
import { loadSources, sourceMetadata } from "../sources.ts";

test("authority comes from each source's metadata.yaml", () => {
  const authoritative = [...loadSources().values()]
    .filter((source) => source.authoritative)
    .map(({ name }) => name);
  expect(authoritative).toEqual([
    "Kartverket / Norwegian Mapping Authority, Hydrographic Service",
    "Toitū Te Whenua Land Information New Zealand",
    "US National Oceanic and Atmospheric Administration",
  ]);
});

test("a source without metadata.yaml is refused", () => {
  expect(() => sourceMetadata("Some Future Source")).toThrow(
    /no sources\/\*\/metadata.yaml declares/,
  );
});
