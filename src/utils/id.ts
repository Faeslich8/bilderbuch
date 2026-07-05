/**
 * Kontext-sichere ID-Erzeugung.
 *
 * `crypto.randomUUID()` ist nur in "secure contexts" (HTTPS oder localhost)
 * verfügbar. Diese App wird häufig über einfaches HTTP ausgeliefert
 * (z. B. http://homeservierer:8080) — dort ist die Methode NICHT vorhanden und
 * ein direkter Aufruf wirft eine Ausnahme. Passiert das innerhalb eines
 * React-setState-Updaters, stürzt der gesamte Render ab (White-Screen).
 *
 * Diese Hilfsfunktion nutzt randomUUID, wenn möglich, und fällt sonst auf eine
 * ausreichend eindeutige Zufalls-ID zurück.
 */
export function randomId(prefix = ""): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `${prefix}${crypto.randomUUID()}`;
    }
  } catch {
    // Insecure context: randomUUID nicht nutzbar -> Fallback unten.
  }
  return `${prefix}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
