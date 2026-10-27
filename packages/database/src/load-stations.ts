import loadBytes from "#slackwater.tcdb";
import { openDatabase } from "./database/reader.js";
import { createStationReader } from "./stations.js";
import { createRoutes } from "./routes.js";
import { createSearch } from "./search/index.js";
import { bundledSearchData, type SearchIndexData } from "./search/bundled.js";
import { Root } from "./generated/fbs/slackwater.ts";
import { ByteBuffer } from "flatbuffers";

/** A Node file path, file/HTTP(S) URL, or an already loaded database buffer. */
export type DatabaseSource = string | URL | Uint8Array;

/**
 * Load the bundled database, or a supplied source. Browsers and Workers accept
 * fetchable URLs and bytes; Node also accepts filesystem paths and file URLs.
 * Loading creates a reader, without materializing any station identities.
 * Each call owns its caches. Call once and reuse the returned instance.
 */
export async function loadStations(
  source?: DatabaseSource,
): Promise<StationDatabase> {
  const bytes = source instanceof Uint8Array ? source : await loadBytes(source);
  const indexes = source === undefined ? await bundledSearchData() : undefined;
  return createDatabase(bytes, indexes);
}

function createDatabase(bytes: Uint8Array, indexes?: SearchIndexData) {
  // This is a format check, not a full structural verifier for arbitrary bytes.
  if (bytes.length < 8 || !Root.bufferHasIdentifier(new ByteBuffer(bytes))) {
    throw new Error("Invalid station database: expected a TCDB FlatBuffer");
  }
  const root = openDatabase(bytes);
  const reader = createStationReader(root);
  return {
    byId: reader.byId,
    qualityFilter: reader.qualityFilter,
    get all() {
      return reader.all;
    },
    get accepted() {
      return reader.accepted;
    },
    get qualityMap() {
      return reader.qualityMap;
    },
    get datums() {
      return reader.datums;
    },
    ...createRoutes(root, reader),
    ...createSearch(bytes, root, reader, indexes),
  };
}

export type StationDatabase = ReturnType<typeof createDatabase>;
