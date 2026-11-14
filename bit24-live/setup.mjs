import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const file = new URL(".env", import.meta.url);
if (existsSync(file))
  throw Error("Existing .env preserved. Edit it privately on the server.");
const password = randomBytes(32).toString("base64url");
writeFileSync(
  file,
  readFileSync(new URL(".env.example", import.meta.url), "utf8").replace(
    "OWNER_PASSWORD=",
    "OWNER_PASSWORD=" + password,
  ),
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Private settings created at " +
    fileURLToPath(file) +
    ". Read OWNER_PASSWORD there; keep it private. Set BIT24_API_KEY server-side.",
);
