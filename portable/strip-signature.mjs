/**
 * Entfernt die Authenticode-Signatur aus einer Windows-EXE.
 *
 * Warum: Die offizielle node.exe ist signiert. Sobald das SEA-Abbild
 * hineininjiziert wird, passt die Signatur nicht mehr zum Inhalt – Windows
 * meldet dann „Signatur beschädigt", was misstrauischer wirkt als eine schlicht
 * unsignierte Datei. Node empfiehlt daher, die Signatur VOR der Injektion zu
 * entfernen (normalerweise mit signtool, das hier nicht vorausgesetzt wird).
 *
 * Vorgehen (PE-Format):
 *   DOS-Header[0x3C] -> Offset des PE-Headers
 *   PE + COFF (24 Byte) -> Optional Header; Magic 0x20b = PE32+, 0x10b = PE32
 *   Data Directory Nr. 4 ("Certificate Table") enthält Datei-Offset + Größe der
 *   Signatur. Eintrag nullen und – wenn die Signatur wie üblich am Dateiende
 *   liegt – die Datei dort abschneiden.
 */

import fs from "node:fs";

export function stripAuthenticode(file) {
  const fd = fs.openSync(file, "r+");
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(1024);
    fs.readSync(fd, head, 0, head.length, 0);

    if (head.readUInt16LE(0) !== 0x5a4d) return { changed: false, reason: "kein MZ-Header" };
    const peOff = head.readUInt32LE(0x3c);
    if (head.readUInt32LE(peOff) !== 0x00004550)
      return { changed: false, reason: "kein PE-Header" };

    const optOff = peOff + 24;
    const magic = head.readUInt16LE(optOff);
    // Data Directories beginnen nach dem Optional Header:
    // PE32+ (0x20b): 112 Byte, PE32 (0x10b): 96 Byte.
    const dirOff = optOff + (magic === 0x20b ? 112 : 96);
    const certEntry = dirOff + 4 * 8; // Eintrag 4 = Certificate Table

    const entry = Buffer.alloc(8);
    fs.readSync(fd, entry, 0, 8, certEntry);
    const certOff = entry.readUInt32LE(0);
    const certSize = entry.readUInt32LE(4);
    if (certOff === 0 || certSize === 0) return { changed: false, reason: "keine Signatur" };

    // Eintrag nullen …
    fs.writeSync(fd, Buffer.alloc(8), 0, 8, certEntry);
    // … und die angehängten Signaturdaten abschneiden, sofern sie am Ende liegen.
    let truncated = 0;
    if (certOff + certSize >= size) {
      fs.ftruncateSync(fd, certOff);
      truncated = size - certOff;
    }
    return { changed: true, removedBytes: certSize, truncated };
  } finally {
    fs.closeSync(fd);
  }
}
