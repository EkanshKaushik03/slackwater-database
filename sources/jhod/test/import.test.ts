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
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURES_DIR,
  importSnapshot,
  refreshSnapshot,
  verifySnapshot,
} from "../import.ts";
import { validate } from "../validate.ts";

describe("JHOD pinned import", () => {
  it("refuses a refresh when its snapshot output is locked", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    const fixtures = join(root, "fixtures");
    try {
      await mkdir(`${fixtures}.lock`);
      await expect(
        refreshSnapshot(`${fixtures}/`, async () => {
          throw new Error("unexpected request while locked");
        }),
      ).rejects.toThrow(/locked/i);
      expect(await readdir(`${fixtures}.lock`)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("preserves an unreviewed record added after the withdrawal check", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    const out = join(root, "jhod");
    const original = fs.writeFile;
    let inserted = false;
    const spy = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (...args) => {
        await original(...args);
        if (!inserted && String(args[0]).startsWith(out + "/")) {
          inserted = true;
          await original(join(out, "0001.json"), "concurrent record\n");
        }
      });
    syncBuiltinESMExports();
    try {
      await importSnapshot(FIXTURES_DIR, root);
      expect(await readFile(join(out, "0001.json"), "utf8")).toBe(
        "concurrent record\n",
      );
    } finally {
      spy.mockRestore();
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
  it("serializes imports of the same output and releases the lock afterward", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      const results = await Promise.allSettled([
        importSnapshot(FIXTURES_DIR, root),
        importSnapshot(FIXTURES_DIR, root),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(
        rejected?.status === "rejected" && String(rejected.reason),
      ).toMatch(/locked/i);
      expect(await importSnapshot(FIXTURES_DIR, root)).toBe(20);
      expect(await readdir(join(root, "jhod"))).toHaveLength(20);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
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
      expect(await readdir(join(root, "data"))).toEqual(["jhod"]);
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

  it("refuses to prune a gauge whose refreshed page lost its constants link", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      const fixtures = join(root, "fixtures");
      await cp(FIXTURES_DIR, fixtures, { recursive: true });
      await mkdir(join(root, "data", "jhod"), { recursive: true });
      await writeFile(join(root, "data", "jhod", "0154.json"), "previous\n");
      const page = (
        await readFile(join(fixtures, "0154-gauge.html"), "utf8")
      ).replace("hc_e.php?s=0154", "unavailable.php?s=0154");
      await writeFile(join(fixtures, "0154-gauge.html"), page);
      const path = join(fixtures, "manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      manifest.files.find(
        (entry: { path: string }) => entry.path === "0154-gauge.html",
      ).sha256 = createHash("sha256").update(page).digest("hex");
      await writeFile(path, JSON.stringify(manifest));
      await expect(
        importSnapshot(fixtures, join(root, "data")),
      ).rejects.toThrow(/withdrawal.*0154/i);
      await expect(
        importSnapshot(fixtures, join(root, "data"), ["0158"]),
      ).rejects.toThrow(/withdrawal.*0154/i);
      expect(
        await readFile(join(root, "data", "jhod", "0154.json"), "utf8"),
      ).toBe("previous\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves the current snapshot when a refresh loses a published gauge", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await cp(FIXTURES_DIR, root, { recursive: true });
      const current = await readFile(join(root, "manifest.json"), "utf8");
      const manifest = JSON.parse(current);
      const byUrl = new Map<string, string>(
        manifest.files.map((entry: { url: string; path: string }) => [
          entry.url,
          entry.path,
        ]),
      );
      const request: typeof fetch = async (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        const path = byUrl.get(url);
        if (!path) throw new Error(`Unexpected URL: ${url}`);
        let page = await readFile(join(FIXTURES_DIR, path), "utf8");
        if (path === "0154-gauge.html")
          page = page.replace("hc_e.php?s=0154", "unavailable.php?s=0154");
        return new Response(page);
      };
      await expect(refreshSnapshot(root, request)).rejects.toThrow(
        /withdrawal.*0154/i,
      );
      expect(await readFile(join(root, "manifest.json"), "utf8")).toBe(current);
      await refreshSnapshot(root, request, ["0154"]);
      expect((await verifySnapshot(root)).harmonics).toHaveLength(19);
      expect(await readdir(root)).not.toContain("0154-constants.html");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a prediction comparison with a mismatched imported station set", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await mkdir(join(root, "jhod"));
      await writeFile(join(root, "jhod", "9999.json"), "{}");
      await expect(validate(FIXTURES_DIR, root)).rejects.toThrow(
        /station set/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compares the imported datum rather than recomputing it from the snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "jhod-test-"));
    try {
      await cp(
        new URL("../../../data/jhod", import.meta.url),
        join(root, "jhod"),
        { recursive: true },
      );
      const path = join(root, "jhod", "0154.json");
      const station = JSON.parse(await readFile(path, "utf8"));
      station.datums.MSL += 1;
      await writeFile(path, JSON.stringify(station));
      await expect(validate(FIXTURES_DIR, root)).rejects.toThrow(
        /0154.*prediction comparison failed/i,
      );
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
      expect(await importSnapshot(FIXTURES_DIR, root, ["9999"])).toBe(20);
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
