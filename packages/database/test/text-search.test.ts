import { describe, test, expect, vi } from "vitest";
import { createTextIndex, loadTextIndex } from "../src/search/text.js";
import { loadStationMeta } from "../src/station-bundle.js";
import type { StationMeta } from "../src/types.js";

vi.mock("../src/station-bundle.js", () => ({ loadStationMeta: vi.fn() }));

function station(id: string, name: string): StationMeta {
  return {
    id,
    name,
    latitude: 0,
    longitude: 0,
    country: "",
    continent: "",
    timezone: "UTC",
    type: "reference",
    source: { id, name: "test", url: "", published_harmonics: true },
  };
}

async function indexFor(stations: StationMeta[]) {
  vi.mocked(loadStationMeta).mockReturnValue(stations);
  // Exercise the production build-time serialization and runtime loader.
  return loadTextIndex(await createTextIndex());
}

describe("text index normalization", () => {
  test.each([
    ["Træna", "Traena"],
    ["Bodø", "Bodo"],
    ["Straße", "Strasse"],
    ["STRAẞE", "Strasse"],
    ["Łeba", "Leba"],
    ["Đồng", "Dong"],
    ["Eiði", "Eidi"],
    ["Fuglafjørður", "Fuglafjordur"],
    ["Þórshöfn", "Thorshofn"],
    ["Œuilly", "Oeuilly"],
    ["Ǽgir", "Aegir"],
    ["Ǿrsta", "Orsta"],
  ])("matches %s and %s exactly after serialization", async (name, plain) => {
    const forms = [name, name.toUpperCase(), name.normalize("NFD")];
    const index = await indexFor([
      ...forms.map((form, i) => station(`gauge${i}`, form)),
      station("plain", plain),
    ]);
    for (const query of [...forms, plain, plain.toUpperCase()]) {
      // Source IDs, prefix and fuzzy matches must not conceal missing folding.
      expect(
        index
          .search(query, { fuzzy: false, prefix: false })
          .map(({ id }) => id)
          .sort(),
      ).toEqual(["gauge0", "gauge1", "gauge2", "plain"]);
    }
  });

  test("folds aliases and context without discarding term boundaries", async () => {
    const index = await indexFor([
      { ...station("alias", "Gauge"), aliases: ["Træna Harbour"] },
      { ...station("context", "Gauge"), context: "Træna Harbour" },
    ]);
    expect(
      index
        .search("TRAENA harbour", {
          fuzzy: false,
          prefix: false,
          combineWith: "AND",
        })
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["alias", "context"]);
    expect(
      index.search("traenaharbour", { fuzzy: false, prefix: false }),
    ).toEqual([]);
  });

  test.each(["ท่าเรือ", "कांदला", "مِينَاء"])(
    "preserves meaningful non-Latin marks in %s",
    async (name) => {
      const unmarked = name.normalize("NFD").replace(/\p{M}/gu, "");
      const index = await indexFor([
        station("marked", name),
        station("unmarked", unmarked),
      ]);
      for (const query of [name, name.normalize("NFD")]) {
        expect(
          index
            .search(query, { fuzzy: false, prefix: false })
            .map(({ id }) => id),
        ).toEqual(["marked"]);
      }
      expect(
        index
          .search(unmarked, { fuzzy: false, prefix: false })
          .map(({ id }) => id),
      ).toEqual(["unmarked"]);
    },
  );
});
