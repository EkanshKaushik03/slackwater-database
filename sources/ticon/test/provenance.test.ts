import { expect, test } from "vitest";
import { declaredOriginator, type UhslcMetadata } from "../provenance.ts";

const meta = (
  data_source: string,
  originator_number: string,
): UhslcMetadata => ({
  station: "",
  latitude: 0,
  longitude: 0,
  data_source,
  originator_number,
  last_updated: "",
});

test("a TICON NOAA relay names its station in its id", () => {
  expect(declaredOriginator("ticon/aberdeen-9441187-usa-noaa")).toBe(
    "noaa/9441187",
  );
});

test("a TICON Norwegian Hydrographic Service relay names its Kartverket code", () => {
  expect(declaredOriginator("ticon/bergen-bgo-nor-nhs")).toBe("kartverket/BGO");
});

test("UHSLC's Norwegian Hydrographic Service gauges match Kartverket by name", () => {
  const pinned = {
    "823A": {
      ...meta("Norwegian Hydrographic Services (NHS)", ""),
      station: "Ny-Alesund",
    },
    "999A": {
      ...meta("Norwegian Hydrographic Services", ""),
      station: "Nowhere",
    },
  };
  expect(declaredOriginator("ticon/nylesund-823a-nor-uhslc_rq", pinned)).toBe(
    "kartverket/NYA",
  );
  expect(
    declaredOriginator("ticon/nowhere-999a-nor-uhslc_rq", pinned),
  ).toBeUndefined();
});

test("UHSLC metadata names an originator only through a known provider", () => {
  const pinned = {
    "073A": meta("Land Information New Zealand", "073"),
    // UHSLC 071 is also La Libertad, Ecuador: the number alone is not enough.
    "071B": meta("Instituto Oceanografico de la Armada", "071"),
    "259B": meta("National Ocean Service (NOS)", "2695535"),
    // UHSLC sometimes records its own code as the originator.
    "104D": meta("UH Sea Level Center", "2431000"),
  };
  expect(declaredOriginator("ticon/tauranga-073a-nzl-uhslc_rq", pinned)).toBe(
    "linz/073",
  );
  expect(
    declaredOriginator("ticon/la_libertad-071b-ecu-uhslc_rq", pinned),
  ).toBeUndefined();
  expect(declaredOriginator("ticon/bermuda-259b-gbr-uhslc_rq", pinned)).toBe(
    "noaa/2695535",
  );
  expect(
    declaredOriginator("ticon/diego_garcia-104d-gbr-uhslc_rq", pinned),
  ).toBeUndefined();
  expect(
    declaredOriginator("ticon/wellington-071-nzl-uhslc_fd", pinned),
  ).toBeUndefined();
});
