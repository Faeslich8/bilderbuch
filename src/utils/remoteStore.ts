/**
 * Zentraler Bearbeitungs-Speicher (geräteübergreifend).
 *
 * Der Container stellt unter /store/ einen schlichten WebDAV-Datei-Store auf
 * einem persistenten Volume bereit (siehe nginx.conf.template). Hier liegt der
 * Client-Zugriff: GET zum Laden, entprelltes PUT zum Speichern.
 *
 * localStorage bleibt lokaler Cache/Offline-Fallback; dieser Store ist die
 * geteilte Quelle der Wahrheit. Konflikte lösen sich per "last write wins" –
 * für ein Heim-Setup ausreichend.
 */

const STORE_BASE = "/store";

/**
 * Lädt einen zentral gespeicherten JSON-String oder null, wenn es (noch) keinen
 * gibt bzw. der Store nicht erreichbar ist. Der Rückgabewert wird als JSON
 * validiert, damit der Vite-Dev-Server (der für unbekannte Pfade index.html
 * ausliefert) nicht versehentlich HTML in den Cache spült.
 */
export async function fetchRemoteConfig(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${STORE_BASE}/${name}.json`, {
      cache: "no-store",
    });
    if (!res.ok) return null; // 404 -> kein zentraler Stand vorhanden
    const text = await res.text();
    try {
      JSON.parse(text);
    } catch {
      return null; // kein valides JSON (z. B. Dev-Server-Fallback) -> ignorieren
    }
    return text;
  } catch {
    return null; // Store nicht erreichbar -> lokal weiterarbeiten
  }
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Speichert entprellt in den zentralen Store. Mehrere schnelle Änderungen (der
 * Editor speichert bei jeder Zustandsänderung) werden zu einem PUT zusammengefasst.
 * Fehler (offline / kein Store) werden geschluckt – der lokale Cache bleibt gültig.
 */
export function scheduleRemoteSave(
  name: string,
  body: string,
  delayMs = 1500,
): void {
  const existing = pending.get(name);
  if (existing) clearTimeout(existing);
  pending.set(
    name,
    setTimeout(() => {
      pending.delete(name);
      fetch(`${STORE_BASE}/${name}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(() => {
        /* offline / kein Store -> lokaler Cache bleibt erhalten */
      });
    }, delayMs),
  );
}

/** Store-Name (Dateiname ohne .json) für eine Album-Konfiguration. */
export const albumStoreName = (albumId: string): string => `album-${albumId}`;

/** Store-Name für die globale Konfiguration. */
export const GLOBAL_STORE_NAME = "global";

/* ------------------------------------------------------------------ */
/* Binär-Dateien (z. B. hochgeladene Fotos lokaler Alben).             */
/* Diese liegen als echte Dateien im Store-Volume und werden per URL   */
/* referenziert (statt base64 in der Konfig) – klein & skalierbar.     */
/* ------------------------------------------------------------------ */

const STORE_ROOT = STORE_BASE; // "/store"

/** Öffentliche URL einer Store-Datei (same-origin, vom nginx-WebDAV geliefert). */
export function storeUrl(path: string): string {
  return `${STORE_ROOT}/${path.replace(/^\/+/, "")}`;
}

/** URL des Mediums (Foto) eines lokalen Albums. */
export function localMediaUrl(albumId: string, mediaId: string): string {
  return storeUrl(`media/${albumId}/${mediaId}.jpg`);
}

/**
 * Lädt ein Binär-Objekt (Foto) in den Store. Wirft bei Fehler, damit der
 * Aufrufer den Upload-Fehler anzeigen kann (anders als die JSON-Konfig, wo ein
 * fehlgeschlagener Push toleriert wird).
 */
export async function putRemoteMedia(
  albumId: string,
  mediaId: string,
  blob: Blob,
): Promise<void> {
  const res = await fetch(localMediaUrl(albumId, mediaId), {
    method: "PUT",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload fehlgeschlagen (HTTP ${res.status})`);
}

/** Löscht ein Medium (best effort). */
export async function deleteRemoteMedia(
  albumId: string,
  mediaId: string,
): Promise<void> {
  try {
    await fetch(localMediaUrl(albumId, mediaId), { method: "DELETE" });
  } catch {
    /* egal */
  }
}

/** Löscht eine beliebige Store-JSON-Datei (best effort). */
export async function deleteRemoteConfig(name: string): Promise<void> {
  try {
    await fetch(`${STORE_ROOT}/${name}.json`, { method: "DELETE" });
  } catch {
    /* egal */
  }
}

/**
 * Speichert SOFORT (unentprellt) eine JSON-Datei im Store und meldet Erfolg.
 * Für Manifest-/Index-Schreibvorgänge lokaler Alben, wo wir auf das Ergebnis
 * warten wollen (anders als der entprellte Editor-Autosave).
 */
export async function putRemoteConfigNow(
  name: string,
  body: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${STORE_ROOT}/${name}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}
