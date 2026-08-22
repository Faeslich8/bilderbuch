# BilderBuch – portable Windows-EXE

Eine einzelne `bilderbuch.exe`, die BilderBuch ohne Installation startet: kein
Docker, kein Node, kein Installer, keine Registry-Einträge. Läuft auch vom
USB-Stick.

## Benutzung

1. `bilderbuch.exe` doppelklicken.
2. Ein Konsolenfenster zeigt die Adresse (Standard `http://localhost:8080`), der
   Standardbrowser öffnet sich automatisch.
3. Zum Beenden das Konsolenfenster schließen oder <kbd>Strg</kbd>+<kbd>C</kbd>.

Neben der EXE entsteht beim ersten Start der Ordner **`bilderbuch-daten/`** –
dort liegen alle Alben, Bücher und hochgeladenen Fotos. Diesen Ordner mitnehmen
oder sichern, dann sind auch die Bücher gesichert.

```
bilderbuch.exe            ← die Anwendung
bilderbuch.config.json    ← optional (siehe unten)
bilderbuch-daten/         ← entsteht automatisch: Alben, Bücher, Fotos
```

## Konfiguration (optional)

Ohne Konfigurationsdatei startet BilderBuch mit **lokalen Alben** – Fotos werden
per Datei-Auswahl oder Drag & Drop hinzugefügt. Für die Immich-Anbindung eine
Datei `bilderbuch.config.json` **neben die EXE** legen:

```json
{
  "immichUrl": "http://mein-server:2283",
  "immichApiKey": "dein-immich-api-schluessel",
  "port": 8080,
  "host": "127.0.0.1",
  "dataDir": "bilderbuch-daten",
  "openBrowser": true
}
```

| Feld           | Bedeutung                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `immichUrl`    | Adresse des Immich-Servers. Leer = nur lokale Alben.                                                    |
| `immichApiKey` | Wird beim Start ausgeliefert, damit man nichts eingeben muss. Leer = die App fragt im Browser danach.   |
| `port`         | Standard 8080. Ist der Port belegt, wird automatisch der nächste freie genommen.                        |
| `host`         | Standard `127.0.0.1` (**nur dieser PC**). Siehe Sicherheitshinweis.                                     |
| `dataDir`      | Ordner für Alben und Fotos, relativ zur EXE.                                                            |
| `openBrowser`  | `false`, wenn sich der Browser nicht automatisch öffnen soll.                                           |

Alternativ per Umgebungsvariable: `IMMICH_URL`, `IMMICH_API_KEY`, `PORT` (haben
Vorrang vor der Datei).

> **Sicherheitshinweis:** Standardmäßig hört die EXE nur auf `127.0.0.1`, ist
> also von anderen Geräten aus nicht erreichbar. Setzt man `host` auf `0.0.0.0`,
> ist BilderBuch im ganzen Heimnetz erreichbar – dann kann **jeder im Netz** den
> hinterlegten Immich-Schlüssel auslesen (er wird über `/config.js` ausgeliefert).
> In dem Fall einen eigenen, nur lesenden Immich-Schlüssel verwenden.

## Warum kein CORS nötig ist

Die EXE bringt denselben Proxy mit wie das Docker-Image: `/api/…` wird
unverändert an `<immichUrl>/api/…` weitergereicht. Der Browser spricht also nur
mit einer einzigen Adresse, und Immich braucht **keine** CORS-Konfiguration.

## Verhältnis zur Docker-Variante

Beide nutzen dieselbe Oberfläche und dasselbe Speicherformat. Unterschied:

|                    | Docker (`portainer-stack.yml`)         | portable EXE                      |
| ------------------ | -------------------------------------- | --------------------------------- |
| Läuft auf          | Server, dauerhaft                      | einem PC, bei Bedarf              |
| Speicher           | Volume `immichbook-store`              | Ordner `bilderbuch-daten/`        |
| Erreichbar für     | alle Geräte im Netz                    | standardmäßig nur dieser PC       |
| Bücher geräteübergreifend | ja                              | nein (lokal)                      |

Die Datenformate sind identisch – man kann den Inhalt von `bilderbuch-daten/store/`
und dem Docker-Volume gegenseitig übernehmen.

## Selbst bauen

Voraussetzung: Node.js 20+ (entwickelt mit Node 24) und die Projekt-Abhängigkeiten.

```bash
npm install
npm run build:exe
```

Ergebnis: `portable/build/bilderbuch.exe`.

Der Build (`build.mjs`) läuft in fünf Schritten: SPA bauen → Oberfläche als
Base64 einbetten → Server mit esbuild bündeln → Node-SEA-Abbild erzeugen →
in eine Kopie der `node.exe` injizieren (deren Signatur vorher entfernt wird,
weil sie durch die Injektion ohnehin ungültig würde).

Die EXE ist rund 95 MB groß – das meiste davon ist die eingebettete
Node.js-Laufzeit, die BilderBuch ohne installiertes Node lauffähig macht.

> Windows zeigt bei unsignierten Programmen einen SmartScreen-Hinweis
> („Unbekannter Herausgeber"). Über *Weitere Informationen → Trotzdem ausführen*
> lässt sich die EXE starten.
