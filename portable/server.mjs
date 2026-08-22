/**
 * BilderBuch – portabler Windows-Server.
 *
 * Ersetzt für die EXE-Variante das, was im Docker-Image nginx erledigt
 * (siehe nginx.conf.template) — mit ABSICHTLICH identischer Semantik:
 *
 *  - statische SPA (in die EXE eingebettet, kein Entpacken nötig)
 *  - /config.js zur Laufzeit aus dem hinterlegten Immich-Schlüssel erzeugt
 *  - /api/…  → unverändert an <immichUrl>/api/… weitergereicht (same-origin,
 *              deshalb braucht Immich KEIN CORS)
 *  - /store/… → schlichter Datei-Store (GET/PUT/DELETE) im Datenordner
 *  - SPA-Fallback auf index.html; /assets/ dauerhaft cachebar, index.html und
 *    /config.js niemals (sonst „fehlen" nach einem Update Funktionen)
 *
 * Konfiguration: bilderbuch.config.json neben der EXE (alle Felder optional).
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ASSETS } from "./assets.generated.mjs";

/* ------------------------------------------------------------------ */
/* Pfade: alles liegt neben der EXE, damit die App wirklich portabel   */
/* ist (USB-Stick, kein Installer, keine Registry, kein AppData).      */
/* ------------------------------------------------------------------ */

function appDir() {
  // Als gepackte EXE ist execPath die EXE selbst (z. B. bilderbuch.exe); startet
  // man die Datei dagegen mit "node server.mjs", ist es die node.exe - dann gilt
  // das aktuelle Verzeichnis.
  const exe = path.basename(process.execPath).toLowerCase();
  const runningAsNode = exe === "node.exe" || exe === "node";
  return runningAsNode ? process.cwd() : path.dirname(process.execPath);
}

const APP_DIR = appDir();
const CONFIG_FILE = path.join(APP_DIR, "bilderbuch.config.json");

const DEFAULTS = {
  // Leer = die App fragt im Browser nach dem Schlüssel bzw. man startet
  // „Ohne Immich" und nutzt nur lokale Alben.
  immichUrl: "",
  immichApiKey: "",
  port: 8080,
  // Standard: NUR dieser PC. Auf "0.0.0.0" setzen, um die App im Heimnetz
  // freizugeben — dann ist der Immich-Schlüssel für jeden im LAN lesbar.
  host: "127.0.0.1",
  dataDir: "bilderbuch-daten",
  openBrowser: true,
};

function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      cfg = { ...cfg, ...raw };
    }
  } catch (e) {
    console.error(`  ! ${path.basename(CONFIG_FILE)} ist fehlerhaft: ${e.message}`);
    console.error("    Es gelten die Standardwerte.");
  }
  // Umgebungsvariablen haben Vorrang (praktisch für Skripte/Tests).
  if (process.env.IMMICH_URL) cfg.immichUrl = process.env.IMMICH_URL;
  if (process.env.IMMICH_API_KEY) cfg.immichApiKey = process.env.IMMICH_API_KEY;
  if (process.env.PORT) cfg.port = Number(process.env.PORT) || cfg.port;
  cfg.immichUrl = String(cfg.immichUrl || "").replace(/\/+$/, "");
  return cfg;
}

const CONFIG = loadConfig();
const STORE_DIR = path.resolve(
  APP_DIR,
  CONFIG.dataDir || DEFAULTS.dataDir,
  "store",
);

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

/** Body eines Requests einsammeln (für PUT in den Store und den API-Proxy). */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error("Body zu groß"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Store-Pfad auflösen und gegen Ausbrüche absichern (kein ".." o. Ä.).
 * Gibt null zurück, wenn der Pfad außerhalb des Store-Ordners landen würde.
 */
function resolveStorePath(urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/store\/?/, ""));
  if (!rel || rel.includes("\0")) return null;
  const abs = path.resolve(STORE_DIR, rel);
  const root = path.resolve(STORE_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/* ------------------------------------------------------------------ */
/* Anfragen                                                            */
/* ------------------------------------------------------------------ */

/** /store/… – GET liest, PUT schreibt (Ordner werden angelegt), DELETE löscht. */
async function handleStore(req, res, urlPath) {
  const file = resolveStorePath(urlPath);
  if (!file) return send(res, 400, "Ungültiger Pfad");

  if (req.method === "GET" || req.method === "HEAD") {
    try {
      const data = await fsp.readFile(file);
      return send(res, 200, req.method === "HEAD" ? "" : data, {
        "Content-Type": mimeFor(file),
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
    } catch {
      return send(res, 404, "Nicht gefunden");
    }
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req, 50 * 1024 * 1024);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, body);
      // 201/204 wie beim nginx-WebDAV: der Client wertet nur res.ok aus.
      return send(res, 204, "");
    } catch (e) {
      return send(res, 500, `Schreiben fehlgeschlagen: ${e.message}`);
    }
  }

  if (req.method === "DELETE") {
    try {
      await fsp.rm(file, { recursive: true, force: true });
      return send(res, 204, "");
    } catch (e) {
      return send(res, 500, `Löschen fehlgeschlagen: ${e.message}`);
    }
  }

  return send(res, 405, "Methode nicht erlaubt");
}

/** /api/… – unverändert an Immich weiterreichen (same-origin, kein CORS). */
async function handleApi(req, res, urlPath) {
  if (!CONFIG.immichUrl) {
    return send(
      res,
      503,
      JSON.stringify({
        error:
          "Keine Immich-Verbindung konfiguriert. Trage immichUrl in bilderbuch.config.json ein " +
          "oder nutze BilderBuch ohne Immich (lokale Alben).",
      }),
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }

  const target = CONFIG.immichUrl + urlPath;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // Hop-by-hop und Host nicht weiterreichen.
    if (["host", "connection", "content-length", "accept-encoding"].includes(k)) continue;
    headers[k] = v;
  }

  try {
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody ? await readBody(req, 100 * 1024 * 1024) : undefined;
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (["content-encoding", "transfer-encoding", "connection"].includes(k)) return;
      outHeaders[k] = v;
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    outHeaders["content-length"] = buf.length;
    return send(res, upstream.status, buf, outHeaders);
  } catch (e) {
    return send(
      res,
      502,
      JSON.stringify({ error: `Immich nicht erreichbar (${CONFIG.immichUrl}): ${e.message}` }),
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }
}

/** Statische SPA aus den eingebetteten Assets. */
function handleStatic(req, res, urlPath) {
  // Laufzeit-Konfig: erzeugt wie docker/immichbook-config.sh im Container.
  if (urlPath === "/config.js") {
    const escaped = String(CONFIG.immichApiKey || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const js = `window.__IMMICHBOOK_CONFIG__ = { apiKey: "${escaped}" };\n`;
    return send(res, 200, js, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    });
  }

  let key = urlPath === "/" ? "/index.html" : urlPath;
  let asset = ASSETS[key];
  // SPA-Routen (z. B. #/albums/…) auf index.html zurückfallen lassen.
  if (!asset) {
    if (path.extname(key)) return send(res, 404, "Nicht gefunden");
    key = "/index.html";
    asset = ASSETS[key];
  }
  if (!asset) return send(res, 404, "Nicht gefunden");

  const buf = Buffer.from(asset, "base64");
  const cache =
    key === "/index.html"
      ? "no-store, no-cache, must-revalidate"
      : key.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";
  return send(res, 200, req.method === "HEAD" ? "" : buf, {
    "Content-Type": mimeFor(key),
    "Content-Length": buf.length,
    "Cache-Control": cache,
  });
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  let urlPath = "/";
  try {
    urlPath = new URL(req.url, "http://localhost").pathname;
  } catch {
    return send(res, 400, "Ungültige Anfrage");
  }

  try {
    if (urlPath.startsWith("/store/")) return await handleStore(req, res, urlPath);
    if (urlPath.startsWith("/api/")) return await handleApi(req, res, urlPath);
    return handleStatic(req, res, urlPath);
  } catch (e) {
    console.error("Fehler:", e);
    if (!res.headersSent) send(res, 500, "Interner Fehler");
  }
});

function openBrowser(url) {
  try {
    // "start" braucht ein leeres Titel-Argument, sonst wird die URL als Titel gedeutet.
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* egal – die Adresse steht ja in der Konsole */
  }
}

async function main() {
  await fsp.mkdir(STORE_DIR, { recursive: true });

  let port = Number(CONFIG.port) || DEFAULTS.port;
  const maxTries = 10;

  for (let i = 0; i < maxTries; i++) {
    const tryPort = port + i;
    const ok = await new Promise((resolve) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE") resolve(false);
        else {
          console.error("Server-Fehler:", e.message);
          process.exit(1);
        }
      });
      server.listen(tryPort, CONFIG.host, () => resolve(true));
    });
    if (ok) {
      port = tryPort;
      break;
    }
    if (i === maxTries - 1) {
      console.error(`Kein freier Port zwischen ${port} und ${port + maxTries - 1}.`);
      process.exit(1);
    }
  }

  const url = `http://localhost:${port}`;
  console.log("");
  console.log("  BilderBuch – Fotobücher aus deinen Immich-Alben");
  console.log("  " + "-".repeat(52));
  console.log(`  Adresse:      ${url}`);
  console.log(`  Daten:        ${path.dirname(STORE_DIR)}`);
  console.log(
    `  Immich:       ${CONFIG.immichUrl || "nicht konfiguriert (nur lokale Alben)"}`,
  );
  console.log(
    `  API-Schlüssel: ${CONFIG.immichApiKey ? "hinterlegt" : "nicht hinterlegt (Abfrage im Browser)"}`,
  );
  if (CONFIG.host !== "127.0.0.1") {
    console.log(`  Freigabe:     ${CONFIG.host} – im Netzwerk erreichbar`);
  }
  console.log("");
  console.log("  Zum Beenden dieses Fenster schließen oder Strg+C drücken.");
  console.log("");

  if (CONFIG.openBrowser) openBrowser(url);
}

main();
