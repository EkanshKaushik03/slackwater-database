import { expect, test } from "vitest";
import { countryByName } from "../country.ts";

test.each([
  ["Western Samoa", "WS", "Samoa"],
  ["Samoa", "WS", "Samoa"],
  ["Cape Verde", "CV", "Cabo Verde"],
  ["Cabo Verde", "CV", "Cabo Verde"],
  ["American Samoa", "AS", "American Samoa"],
])("resolves %s to %s", (name, iso2, country) => {
  expect(countryByName(name)).toMatchObject({ iso2, country });
});

test("rejects unknown country names", () => {
  expect(countryByName("Unknown country")).toBeNull();
});
