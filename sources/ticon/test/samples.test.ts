import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  cachedRefit,
  extendsGeslaRecord,
  parseTiconSamples,
} from "../samples.ts";
const text =
  "# TIME ZONE HOURS 0\n2020/01/15 12:00:00 5 1 1\n2020/07/15 12:00:00 6 1 1\n";
test.each([
  ["gauge-deu-wsv", ["2020-01-15T11:00:00.000Z", "2020-07-15T10:00:00.000Z"]],
  ["gauge-nld-rws", ["2020-01-15T12:00:00.000Z", "2020-07-15T11:00:00.000Z"]],
  [
    "gauge-nld-rws_hist",
    ["2020-01-15T12:00:00.000Z", "2020-07-15T12:00:00.000Z"],
  ],
  [
    "hong_kong-329-hkg-uhslc_fd",
    ["2020-01-15T13:00:00.000Z", "2020-07-15T13:00:00.000Z"],
  ],
  [
    "gauge-hkg-uhslc_fd",
    ["2020-01-15T12:00:00.000Z", "2020-07-15T12:00:00.000Z"],
  ],
])("aligns %s samples with its UTC harmonic phases", (id, expected) => {
  expect(
    parseTiconSamples(id as string, text).map((p) => p.time.toISOString()),
  ).toEqual(expected);
});

// GESLA-4 ends at 12:00 as UHSLC stamps it, 13:00 UTC once shifted. An RQD
// record stamped one hour later is one hour longer; one stamped the same is not.
test.each([
  ["2020-07-15T13:00:00Z", true],
  ["2020-07-15T12:00:00Z", false],
])(
  "compares an early gauge's RQD end %s with its GESLA-4 end in UTC",
  (rqEnd, extends_) => {
    const id = "hong_kong-329b-hkg-uhslc_rq";
    expect(
      extendsGeslaRecord(id, new Date(rqEnd), parseTiconSamples(id, text)),
    ).toBe(extends_);
  },
);

// The fixture is hong_kong-329-hkg-uhslc_fd.json as saved before the station
// was re-fit: its constituents equal TICON-4's published rows, M2 at 7.337671°.
test("re-fits a saved station that still holds TICON's published constituents", () => {
  const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
  const published = read(
    new URL(
      "../fixtures/hong_kong-329-hkg-uhslc_fd-published.json",
      import.meta.url,
    ),
  ).harmonic_constituents;
  const refit = read(
    new URL(
      "../../../data/ticon/hong_kong-329-hkg-uhslc_fd.json",
      import.meta.url,
    ),
  ).harmonic_constituents;
  expect(cachedRefit(published, published)).toBeUndefined();
  expect(cachedRefit(refit, published)).toBe(refit);
});
