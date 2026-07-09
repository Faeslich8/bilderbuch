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
