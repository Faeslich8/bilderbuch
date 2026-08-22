/**
 * Baut die portable Windows-EXE von BilderBuch.
 *
 * Ablauf:
 *   1. Vite-Build der SPA (dist/)
 *   2. dist/ als Base64 in assets.generated.mjs einbetten
 *   3. server.mjs + Assets mit esbuild zu einer einzelnen CJS-Datei bündeln
 *   4. Node-SEA-Blob erzeugen und in eine Kopie der node.exe injizieren
 *
 * Ergebnis: portable/build/bilderbuch.exe – eine Datei, kein Installer.
 *
 * Aufruf:  npm run build:exe
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAuthenticode } from "./strip-signature.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(HERE, "build");
const EXE = path.join(OUT, "bilderbuch.exe");

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const step = (n, msg) => console.log(`\n[${n}/5] ${msg}`);

function run(cmd, args, opts = {}) {
  // Bewusst OHNE shell: Pfade dieses Projekts koennen Leerzeichen enthalten,
  // die eine Shell unquotiert zerlegen wuerde.
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

/** Alle Dateien unterhalb von dir als relative POSIX-Pfade. */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, base)));
    else out.push("/" + path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

async function main() {
  if (process.platform !== "win32") {
    console.warn("Hinweis: Dieses Skript erzeugt eine Windows-EXE und sollte unter Windows laufen.");
  }

  /* 1 – SPA bauen -------------------------------------------------- */
  step(1, "SPA bauen (vite build)…");
  run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: ROOT,
  });
  if (!fs.existsSync(DIST)) throw new Error("dist/ wurde nicht erzeugt.");

  /* 2 – Assets einbetten ------------------------------------------- */
  step(2, "Oberfläche in die EXE einbetten…");
  const files = await walk(DIST);
  let total = 0;
  const parts = [];
  for (const rel of files) {
    const buf = await fsp.readFile(path.join(DIST, rel.slice(1)));
    total += buf.length;
    parts.push(`  ${JSON.stringify(rel)}: ${JSON.stringify(buf.toString("base64"))},`);
  }
  const generated =
    "// AUTOMATISCH ERZEUGT von portable/build.mjs – nicht von Hand bearbeiten.\n" +
    "// Enthält die gebaute Oberfläche (dist/) als Base64, damit die EXE ohne\n" +
    "// Begleitdateien auskommt.\n" +
    "export const ASSETS = {\n" +
    parts.join("\n") +
    "\n};\n";
  await fsp.writeFile(path.join(HERE, "assets.generated.mjs"), generated);
  console.log(`      ${files.length} Dateien, ${mb(total)} eingebettet`);

  /* 3 – Bündeln ----------------------------------------------------- */
  step(3, "Server bündeln (esbuild)…");
  await fsp.mkdir(OUT, { recursive: true });
  const bundle = path.join(OUT, "bundle.cjs");
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [path.join(HERE, "server.mjs")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: bundle,
  });
  console.log(`      ${mb((await fsp.stat(bundle)).size)} Bundle`);

  /* 4 – SEA-Blob ---------------------------------------------------- */
  step(4, "Programm-Abbild erzeugen (Node SEA)…");
  const seaConfig = path.join(OUT, "sea-config.json");
  const blob = path.join(OUT, "sea-prep.blob");
  await fsp.writeFile(
    seaConfig,
    JSON.stringify(
      { main: bundle, output: blob, disableExperimentalSEAWarning: true },
      null,
      2,
    ),
  );
  run(process.execPath, ["--experimental-sea-config", seaConfig]);

  /* 5 – In node.exe injizieren -------------------------------------- */
  step(5, "EXE schnüren…");
  await fsp.copyFile(process.execPath, EXE);
  // Signatur der node.exe entfernen: nach der Injektion waere sie ohnehin
  // ungueltig, und eine kaputte Signatur wirkt misstrauischer als gar keine.
  const sig = stripAuthenticode(EXE);
  console.log(
    sig.changed
      ? `      Signatur der node.exe entfernt (${(sig.removedBytes / 1024).toFixed(0)} kB)`
      : `      Signatur: ${sig.reason}`,
  );
  run(process.execPath, [
    path.join(ROOT, "node_modules", "postject", "dist", "cli.js"),
    EXE,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ]);

  // Zwischendateien aufräumen – nur die EXE bleibt übrig.
  for (const f of [bundle, blob, seaConfig]) await fsp.rm(f, { force: true });

  const size = (await fsp.stat(EXE)).size;
  console.log("\n" + "=".repeat(58));
  console.log(`  Fertig:  ${EXE}`);
  console.log(`  Größe:   ${mb(size)}`);
  console.log("=".repeat(58));
  console.log("\n  Zum Verteilen genügt diese eine Datei.");
  console.log("  Optional daneben: bilderbuch.config.json (siehe portable/README.md)\n");
}

main().catch((e) => {
  console.error("\nBuild fehlgeschlagen:", e.message);
  process.exit(1);
});
