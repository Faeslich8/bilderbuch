/**
 * Schema-Migration für immich-book localStorage-Bücher (Phase 1).
 *
 * V1 (heutiges Format, ohne `schemaVersion`) -> V2 (Element-Modell).
 *
 * Regeln (siehe PHASE1-PageElement-Design.md):
 *  - Fehlt `schemaVersion`, wird als V1 interpretiert: overlayElements = {},
 *    descriptionPositions -> imageCaptions migriert, schemaVersion = 2 gesetzt.
 *  - Alte Bücher sehen dadurch UNVERÄNDERT aus (kein Overlay).
 *  - overlayElements werden über eine stabile Seiten-ID adressiert; Migration
 *    legt sie leer an (es gab vorher keine freien Elemente).
 *  - Unbekannte/kaputte Element-Typen werden defensiv verworfen statt zu crashen.
 */

import type { PageElement } from "../types/pageElement";
import type {
  AlbumConfigV2,
  GlobalConfig,
  PageAlignment,
  Position,
  StoredImageCaption,
  TitlePageConfig,
  ExtraPage,
  CropPosition,
} from "./albumConfig";

const SCHEMA_VERSION = 2 as const;

const VALID_ELEMENT_TYPES = new Set(["image", "text", "shape", "emoji"]);

/** Position (Legacy) -> CaptionPosition. Lokale Kopie, um Importzyklus-Werte zu vermeiden. */
function positionToCaption(pos: Position): StoredImageCaption["position"] {
  switch (pos) {
    case "top":
      return "above";
    case "left":
      return "left";
    case "right":
      return "right";
    case "bottom":
    default:
      return "below";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Minimal-Validierung eines gespeicherten Elements. */
export function validatePageElement(raw: unknown): raw is PageElement {
  if (!isPlainObject(raw)) return false;
  if (typeof raw.type !== "string" || !VALID_ELEMENT_TYPES.has(raw.type)) {
    return false;
  }
  const numeric = ["x", "y", "width", "height", "rotation", "zIndex"];
  for (const k of numeric) {
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k] as number)) {
      return false;
    }
  }
  if (typeof raw.id !== "string") return false;
  return true;
}

function sanitizeOverlayElements(
  raw: unknown,
): Record<string, PageElement[]> {
  const out: Record<string, PageElement[]> = {};
  if (!isPlainObject(raw)) return out;
  for (const [pageId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const valid = list.filter(validatePageElement) as PageElement[];
    if (valid.length > 0) out[pageId] = valid;
  }
  return out;
}

function sanitizeImageCaptions(
  raw: unknown,
): Record<string, StoredImageCaption> {
  const out: Record<string, StoredImageCaption> = {};
  if (!isPlainObject(raw)) return out;
  for (const [assetId, cap] of Object.entries(raw)) {
    if (isPlainObject(cap) && typeof cap.position === "string") {
      out[assetId] = cap as unknown as StoredImageCaption;
    }
  }
  return out;
}

function captionsFromDescriptionPositions(
  raw: unknown,
): Record<string, StoredImageCaption> {
  const out: Record<string, StoredImageCaption> = {};
  if (!isPlainObject(raw)) return out;
  for (const [assetId, pos] of Object.entries(raw)) {
    if (pos === "bottom" || typeof pos !== "string") continue;
    if (pos === "top" || pos === "left" || pos === "right") {
      out[assetId] = { position: positionToCaption(pos as Position) };
    }
  }
  return out;
}

function sanitizeTitlePage(raw: unknown): TitlePageConfig | null {
  if (!isPlainObject(raw)) return null;
  return {
    imageSrc: typeof raw.imageSrc === "string" ? raw.imageSrc : undefined,
    title: typeof raw.title === "string" ? raw.title : "",
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
  };
}

function sanitizeExtraPages(raw: unknown): ExtraPage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is ExtraPage =>
        isPlainObject(p) &&
        typeof p.id === "string" &&
        typeof p.afterPage === "number",
    )
    .map((p) => ({ id: p.id, afterPage: p.afterPage }));
}

function sanitizeCropPositions(raw: unknown): Record<string, CropPosition> {
  const out: Record<string, CropPosition> = {};
  if (!isPlainObject(raw)) return out;
  for (const [assetId, pos] of Object.entries(raw)) {
    if (
      isPlainObject(pos) &&
      typeof pos.x === "number" &&
      typeof pos.y === "number" &&
      Number.isFinite(pos.x) &&
      Number.isFinite(pos.y)
    ) {
      out[assetId] = {
        x: Math.min(100, Math.max(0, pos.x)),
        y: Math.min(100, Math.max(0, pos.y)),
      };
    }
  }
  return out;
}

function pickGlobal(
  raw: Record<string, unknown>,
  fallback: GlobalConfig,
): GlobalConfig {
  const pick = <T>(key: keyof GlobalConfig, fb: T): T =>
    (raw[key as string] ?? fb) as T;
  return {
    pageSize: pick("pageSize", fallback.pageSize),
    orientation: pick("orientation", fallback.orientation),
    pageWidth: pick("pageWidth", fallback.pageWidth),
    pageHeight: pick("pageHeight", fallback.pageHeight),
    margin: pick("margin", fallback.margin),
    combinePages: pick("combinePages", fallback.combinePages),
    rowHeight: pick("rowHeight", fallback.rowHeight),
    spacing: pick("spacing", fallback.spacing),
    filterVideos: pick("filterVideos", fallback.filterVideos),
    showDates: pick("showDates", fallback.showDates),
    showDescriptions: pick("showDescriptions", fallback.showDescriptions),
    fontSize: pick("fontSize", fallback.fontSize),
    pageBackground: pick("pageBackground", fallback.pageBackground),
  };
}

/**
 * Migriert eine roh aus localStorage gelesene Album-Konfiguration auf V2.
 * `globalConfig` liefert Defaults für fehlende Felder.
 */
export function migrateRawAlbumConfig(
  raw: unknown,
  globalConfig: GlobalConfig,
): AlbumConfigV2 {
  // Neuer / leerer Eintrag.
  if (!isPlainObject(raw)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ...globalConfig,
      customAspectRatios: {},
      customOrdering: null,
      pageAlignments: {},
      cropPositions: {},
      overlayElements: {},
      imageCaptions: {},
      excludedAssetIds: [],
      titlePage: null,
      extraPages: [],
    };
  }

  const global = pickGlobal(raw, globalConfig);

  const customAspectRatios = isPlainObject(raw.customAspectRatios)
    ? (raw.customAspectRatios as Record<string, number>)
    : {};
  const customOrdering = Array.isArray(raw.customOrdering)
    ? (raw.customOrdering as string[])
    : null;
  const pageAlignments = isPlainObject(raw.pageAlignments)
    ? (raw.pageAlignments as Record<number, PageAlignment>)
    : {};
  const excludedAssetIds = Array.isArray(raw.excludedAssetIds)
    ? (raw.excludedAssetIds as string[])
    : [];

  // Bereits V2?
  if (raw.schemaVersion === SCHEMA_VERSION) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ...global,
      customAspectRatios,
      customOrdering,
      pageAlignments,
      cropPositions: sanitizeCropPositions(raw.cropPositions),
      overlayElements: sanitizeOverlayElements(raw.overlayElements),
      imageCaptions: sanitizeImageCaptions(raw.imageCaptions),
      excludedAssetIds,
      titlePage: sanitizeTitlePage(raw.titlePage),
      extraPages: sanitizeExtraPages(raw.extraPages),
    };
  }

  // V1 -> V2: descriptionPositions in imageCaptions migrieren.
  return {
    schemaVersion: SCHEMA_VERSION,
    ...global,
    customAspectRatios,
    customOrdering,
    pageAlignments,
    cropPositions: {},
    overlayElements: {},
    imageCaptions: captionsFromDescriptionPositions(raw.descriptionPositions),
    excludedAssetIds,
    titlePage: null,
    extraPages: [],
  };
}
