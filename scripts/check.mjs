import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "manifest.json", "newtab.html", "styles.css", "newtab.js", "motion.js",
  "google.js", "x.js", "chatgpt-autosend.js", "icons/icon16.png",
  "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"
];
const scripts = ["newtab.js", "motion.js", "google.js", "x.js", "chatgpt-autosend.js", "x-broker.js"];

for (const file of required) {
  const target = path.join(root, file);
  if (!statSync(target).isFile()) throw new Error(`Missing required file: ${file}`);
}

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
if (manifest.name !== "BrowserSlop") throw new Error("Manifest branding is incorrect");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Manifest version must be semver-like");

for (const file of scripts) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${file} failed syntax validation:\n${result.stderr}`);
}

const scanFiles = ["manifest.json", "newtab.html", "styles.css", ...scripts, "README.md"];
const source = scanFiles.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
const legacyBrand = new RegExp(["edge", "cal"].join(""), "i");
if (legacyBrand.test(source)) throw new Error("Legacy source branding remains in release files");
if (/\b\d{8,}-[a-z0-9-]+\.apps\.googleusercontent\.com\b/i.test(source)) {
  throw new Error("A Google OAuth client ID appears to be bundled");
}
if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) {
  throw new Error("A private key appears to be bundled");
}

console.log(`BrowserSlop ${manifest.version}: validation passed`);
