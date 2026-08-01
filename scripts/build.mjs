import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = spawnSync(process.execPath, [path.join(root, "scripts/check.mjs")], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status ?? 1);

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const destination = path.join(root, "dist", "BrowserSlop");
const files = [
  "manifest.json", "newtab.html", "styles.css", "newtab.js", "motion.js",
  "google.js", "x.js", "chatgpt-autosend.js", "x-broker.js", "Start-X-Broker.ps1",
  "README.md", "PRIVACY.md", "LICENSE", "icons/icon16.png", "icons/icon32.png",
  "icons/icon48.png", "icons/icon128.png"
];

rmSync(path.join(root, "dist"), { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const file of files) {
  const target = path.join(destination, file);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(root, file), target);
}
writeFileSync(path.join(destination, "BUILD.txt"), `BrowserSlop ${manifest.version}\nBuilt ${new Date().toISOString()}\n`);
console.log(`Built BrowserSlop ${manifest.version} at ${destination}`);
