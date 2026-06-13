/**
 * Adapter: Auto-Layout (PhotoBox/Page aus pageLayout.ts) -> Element-Modell.
 *
 * Phase 1. Hält die Layout-Engine unangetastet und übersetzt ihre Ausgabe in
 * das einheitliche PageElement-Modell, das Renderer (Phase 2) und Interaktion
 * (Phase 3) konsumieren.
 *
 * Wichtig:
 *  - Auto-Bilder bekommen eine deterministische ID (aus der assetId), damit ein
 *    Re-Layout keine Identitäten zerstört.
 *  - Overlay-Elemente werden über eine STABILE Seiten-ID adressiert
 *    (computeStablePageId), nicht über die volatile pageNumber.
 *  - Die finale Elementliste je Seite ist nach zIndex sortiert; Overlay liegt
 *    standardmäßig über den Auto-Bildern.
 */

import type { Page, PhotoBox } from "./pageLayout";
import type {
  ImageElement,
  PageElement,
  ElementPage,
  ElementCaption,
} from "../types/pageElement";
import type { StoredImageCaption } from "./albumConfig";

export interface ElementBuildContext {
  /** Nutzer-Elemente je stabiler Seiten-ID. */
  overlayElements?: Record<string, PageElement[]>;
  /** Kanonische Bildbeschriftungen je assetId. */
  imageCaptions?: Record<string, StoredImageCaption>;
  /** Beschriftungen global ein-/ausblenden (entspricht showDescriptions). */
  showCaptions?: boolean;
  /** Standard-Schriftgröße für Beschriftungen (Pixel @ 300 DPI). */
  captionFontSize?: number;
}

/**
 * Stabile Seiten-ID, abgeleitet aus dem ersten (Auto-)Bild der Seite.
 *
 * Hinweis/Trade-off: Wechselt die Seitenkomposition (z. B. durch geänderte
 * Row-Height), kann sich das "erste" Asset verschieben. Für eine vollständig
 * stabile Bindung über alle Einstellungen hinweg müsste perspektivisch eine
 * eigene, persistente Seiten-ID vergeben werden (Phase-2-Detail). Für den
 * üblichen Fall (gleiche Einstellungen) ist die Asset-basierte ID stabil.
 */
export function computeStablePageId(page: Page): string {
  const first = page.photos[0];
  if (first) return `page:${first.asset.id}`;
  return `page:empty:${page.pageNumber}`;
}

/** Deterministische ID für ein Auto-Bild. */
function autoImageId(box: PhotoBox): string {
  return `auto:${box.asset.id}`;
}

function buildCaption(
  box: PhotoBox,
  spec: StoredImageCaption | undefined,
  defaultFontSize: number,
): ElementCaption | undefined {
  if (!spec) return undefined;
  const text = box.asset.exifInfo?.description ?? "";
  if (!text) return undefined; // leere Beschriftung -> keine
  return {
    text,
    position: spec.position,
    fontSize: spec.fontSize ?? defaultFontSize,
    color: spec.color ?? "#000000",
    align: spec.align ?? "left",
  };
}

/** Eine PhotoBox in ein ImageElement (source: "auto") übersetzen. */
export function photoBoxToImageElement(
  box: PhotoBox,
  zIndex: number,
  ctx: ElementBuildContext = {},
): ImageElement {
  const spec = ctx.showCaptions
    ? ctx.imageCaptions?.[box.asset.id]
    : undefined;
  const caption = buildCaption(box, spec, ctx.captionFontSize ?? 36);
  return {
    id: autoImageId(box),
    type: "image",
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    zIndex,
    assetId: box.asset.id,
    objectFit: "cover",
    lockAspectRatio: false,
    source: "auto",
    ...(caption ? { caption } : {}),
  };
}

/**
 * Auto-Bilder einer Seite + zugehörige Overlay-Elemente zu einer sortierten
 * ElementPage zusammenführen. Overlay liegt standardmäßig über den Auto-Bildern.
 */
export function pageToElementPage(
  page: Page,
  ctx: ElementBuildContext = {},
): ElementPage {
  const pageId = computeStablePageId(page);

  const autoElements: PageElement[] = page.photos.map((box, i) =>
    photoBoxToImageElement(box, i, ctx),
  );

  const overlayRaw = ctx.overlayElements?.[pageId] ?? [];
  // Overlay über die Auto-Bilder heben (zIndex-Offset), Reihenfolge innerhalb
  // des Overlays über deren eigenen zIndex erhalten.
  const base = autoElements.length;
  const overlayElements: PageElement[] = overlayRaw.map((el, i) => ({
    ...el,
    zIndex: base + (Number.isFinite(el.zIndex) ? el.zIndex : i),
  }));

  const elements = [...autoElements, ...overlayElements].sort(
    (a, b) => a.zIndex - b.zIndex,
  );

  return {
    id: pageId,
    width: page.width,
    height: page.height,
    elements,
  };
}

/** Bequemer Wrapper: ganze Seitenliste übersetzen. */
export function pagesToElementPages(
  pages: Page[],
  ctx: ElementBuildContext = {},
): ElementPage[] {
  return pages.map((page) => pageToElementPage(page, ctx));
}
