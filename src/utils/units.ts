/**
 * Zentrale Einheiten-Umrechnung (CLAUDE.md-Invariante 2: „Einheiten zentral").
 *
 * Die Geometrie lebt in Pixeln @ 300 DPI. Davon abgeleitet:
 *  - PDF/Export:  Punkte = px · 72/300   (@react-pdf rechnet intern in 72 DPI)
 *  - Bildschirm:  die Vorschau wird auf dieselbe 72-DPI-Größe skaliert,
 *                 nutzt also denselben Faktor wie der Export (toPoints).
 *  - Maus-Deltas: Bildschirm-Delta · 300/72 → zurück in 300-DPI-Pixel.
 *
 * Diese Faktoren NICHT über den Code verstreuen – ausschließlich hier kapseln,
 * damit Editor und Export nie auseinanderdriften.
 */
export const LAYOUT_DPI = 300;
export const EXPORT_DPI = 72;

/** Pixel @300 DPI → Punkte @72 DPI (PDF) bzw. skalierte Bildschirm-Pixel (Vorschau). */
export const toPoints = (pixels: number): number =>
  pixels * (EXPORT_DPI / LAYOUT_DPI);

/** Bildschirm-Pixel @72 DPI → Layout-Pixel @300 DPI (z. B. Maus-Deltas im Editor). */
export const screenToLayoutPx = (screenPixels: number): number =>
  screenPixels * (LAYOUT_DPI / EXPORT_DPI);
