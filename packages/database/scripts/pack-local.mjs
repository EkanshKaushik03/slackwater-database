// Build and pack @slackwater/database for a consumer to test against before a
// release, and print the tarball's absolute path for `npm install <path>`.
//
//   npm run pack:local [-- <directory>]
//
// The tarball lands in <directory>, by default the repo's tmp/pack. `npm pack`
// runs the package's prepare script, which is the full build.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");
const destination = resolve(process.argv[2] ?? join(root, "tmp", "pack"));
mkdirSync(destination, { recursive: true });
const output = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", destination],
  {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
// prepare's build logs share stdout; the JSON report is the last array.
const start = output.lastIndexOf("\n[\n") + 1;
const [{ filename }] = JSON.parse(output.slice(start));
console.log(join(destination, filename));
