import { expect, test, vi } from "vitest";

test("importing the public entry neither loads bytes nor reads station records", async () => {
  vi.resetModules();
  const loadBytes = vi.fn(() => {
    throw new Error("unexpected byte loading");
  });
  vi.doMock("#slackwater.tcdb", () => ({ default: loadBytes }));
  const { Root } = await import("../src/generated/fbs/slackwater.ts");
  const records = vi.spyOn(Root.prototype, "stations");
  try {
    const api = await import("../src/index.js");
    expect(api.loadStations).toBeTypeOf("function");
    expect(api.routePath("tide", { slug: "harbour", country_code: "CA" })).toBe(
      "/tides/ca/harbour/",
    );
    expect(loadBytes).not.toHaveBeenCalled();
    expect(records).not.toHaveBeenCalled();
  } finally {
    records.mockRestore();
    vi.doUnmock("#slackwater.tcdb");
    vi.resetModules();
  }
});
