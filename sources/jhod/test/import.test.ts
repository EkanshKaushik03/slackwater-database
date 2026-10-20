import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURES_DIR,
  importSnapshot,
  refreshSnapshot,
  verifySnapshot,
} from "../import.ts";
import { validate } from "../validate.ts";

describe("JHOD pinned import", () => {
  it("finds only the 20 gauges linking complete JHOD constants", async () => {
    expect((await verifySnapshot()).harmonics).toHaveLength(20);
  });

  it("rejects a changed response before touching existing records", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await cp(FIXTURES_DIR, join(root, "fixtures"), { recursive: true });
      await writeFile(join(root, "fixtures", "0154-constants.html"), "corrupt");
      await mkdir(join(root, "data", "jhod"), { recursive: true });
      await writeFile(join(root, "data", "jhod", "0154.json"), "previous\n");
      await expect(
        importSnapshot(join(root, "fixtures"), join(root, "data")),
      ).rejects.toThrow(/checksum/i);
      expect(
        await readFile(join(root, "data", "jhod", "0154.json"), "utf8"),
      ).toBe("previous\n");
      expect(await readdir(join(root, "data", "jhod"))).toEqual(["0154.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a missing page from silently removing a published station", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await cp(FIXTURES_DIR, root, { recursive: true });
      const manifestPath = join(root, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.files = manifest.files.filter(
        (entry: { path: string }) => entry.path !== "0154-constants.html",
      );
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(verifySnapshot(root)).rejects.toThrow(/missing.*0154/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("matches the publisher's hourly predictions at all 20 stations", async () => {
    const results = await validate();
    expect(results).toHaveLength(20);
    expect(Math.max(...results.map((r) => r.maximum))).toBeLessThan(0.05);
    expect(Math.max(...results.map((r) => r.rmse))).toBeLessThan(0.03);
  });

  it("rejects a successful HTTP response containing an error page", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await cp(FIXTURES_DIR, root, { recursive: true });
      const body = "<html><title>Temporarily unavailable</title></html>";
      await writeFile(join(root, "0154-gauge.html"), body);
      const manifestPath = join(root, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.files.find(
        (entry: { path: string }) => entry.path === "0154-gauge.html",
      ).sha256 = createHash("sha256").update(body).digest("hex");
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(verifySnapshot(root)).rejects.toThrow(/0154.*gauge/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the pinned snapshot when the publisher is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await writeFile(join(root, "manifest.json"), "previous\n");
      await expect(
        refreshSnapshot(
          root,
          async () => new Response("unavailable", { status: 503 }),
        ),
      ).rejects.toThrow(/503/);
      expect(await readFile(join(root, "manifest.json"), "utf8")).toBe(
        "previous\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes the full release at published precision and removes withdrawn records", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await mkdir(join(root, "jhod"));
      await writeFile(join(root, "jhod", "9999.json"), "withdrawn\n");
      expect(await importSnapshot(FIXTURES_DIR, root)).toBe(20);
      expect(await readdir(join(root, "jhod"))).toHaveLength(20);
      const sasebo = JSON.parse(
        await readFile(join(root, "jhod", "0154.json"), "utf8"),
      );
      expect(sasebo).toMatchObject({
        chart_datum: "NLLW",
        datums: { NLLW: 0, MSL: 1.65 },
      });
      expect(
        sasebo.harmonic_constituents.find(
          (c: { name: string }) => c.name === "M2",
        ),
      ).toEqual({ name: "M2", amplitude: 0.8121, phase: 340.82222222222 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
