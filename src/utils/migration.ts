/**
 * Schema-Migration für BilderBuch localStorage-Bücher (Phase 1).
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
  StyledText,
  DrawStroke,
  MapConfig,
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
    ...(raw.orientation === "portrait" || raw.orientation === "landscape"
      ? { orientation: raw.orientation }
      : {}),
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

/** Bilddrehungen säubern: nur 0/90/180/270; 0 wird gar nicht erst gespeichert. */
function sanitizeRotations(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isPlainObject(raw)) return out;
  for (const [assetId, deg] of Object.entries(raw)) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) continue;
    const norm = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    if (norm !== 0) out[assetId] = norm;
  }
  return out;
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
      const scale =
        typeof pos.scale === "number" && Number.isFinite(pos.scale)
          ? Math.min(4, Math.max(1, pos.scale))
          : undefined;
      out[assetId] = {
        x: Math.min(100, Math.max(0, pos.x)),
        y: Math.min(100, Math.max(0, pos.y)),
        ...(scale && scale > 1 ? { scale } : {}),
      };
    }
  }
  return out;
}

/**
 * Leerraum-Texte / Bildunterschriften säubern. Akzeptiert sowohl das alte
 * Format (reiner String) als auch das neue StyledText-Objekt.
 */
function sanitizeStyledTextRecord(raw: unknown): Record<string, StyledText> {
  const out: Record<string, StyledText> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "string") {
      out[key] = { text: val };
    } else if (isPlainObject(val) && typeof val.text === "string") {
      const st: StyledText = { text: val.text };
      if (typeof val.fontSize === "number" && Number.isFinite(val.fontSize))
        st.fontSize = Math.min(200, Math.max(4, val.fontSize));
      if (typeof val.color === "string") st.color = val.color;
      if (typeof val.fontFamily === "string") st.fontFamily = val.fontFamily;
      if (typeof val.backgroundColor === "string")
        st.backgroundColor = val.backgroundColor;
      out[key] = st;
    }
  }
  return out;
}

/** Freihand-Zeichnungen je Leerraum defensiv säubern. */
function sanitizeBlockerDrawings(
  raw: unknown,
): Record<string, DrawStroke[]> {
  const out: Record<string, DrawStroke[]> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, strokes] of Object.entries(raw)) {
    if (!Array.isArray(strokes)) continue;
    const valid: DrawStroke[] = [];
    for (const s of strokes) {
      if (
        isPlainObject(s) &&
        Array.isArray(s.pts) &&
        s.pts.length >= 2 &&
        s.pts.every((n) => typeof n === "number" && Number.isFinite(n)) &&
        typeof s.color === "string" &&
        typeof s.width === "number" &&
        Number.isFinite(s.width)
      ) {
        valid.push({
          pts: s.pts as number[],
          color: s.color,
          width: Math.min(80, Math.max(0.5, s.width)),
        });
      }
    }
    if (valid.length > 0) out[key] = valid;
  }
  return out;
}

/** Karten-Leerräume je Blocker defensiv säubern. */
function sanitizeBlockerMaps(raw: unknown): Record<string, MapConfig> {
  const out: Record<string, MapConfig> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, m] of Object.entries(raw)) {
    if (!isPlainObject(m)) continue;
    const cfg: MapConfig = {};
    if (typeof m.zoom === "number" && Number.isFinite(m.zoom))
      cfg.zoom = Math.min(22, Math.max(0, m.zoom));
    if (typeof m.centerLng === "number" && Number.isFinite(m.centerLng))
      cfg.centerLng = m.centerLng;
    if (typeof m.centerLat === "number" && Number.isFinite(m.centerLat))
      cfg.centerLat = m.centerLat;
    if (typeof m.snapshot === "string" && m.snapshot.startsWith("data:"))
      cfg.snapshot = m.snapshot;
    out[key] = cfg;
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
    layoutMode: pick("layoutMode", fallback.layoutMode),
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
      heightFactors: {},
      imageAlignments: {},
      dateVisibility: {},
      rotations: {},
      customOrdering: null,
      pageAlignments: {},
      pageLayoutModes: {},
      cropPositions: {},
      blockerTexts: {},
      imageCaptionTexts: {},
      blockerDrawings: {},
      blockerMaps: {},
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
  const heightFactors = isPlainObject(raw.heightFactors)
    ? (raw.heightFactors as Record<string, number>)
    : {};
  const imageAlignments = isPlainObject(raw.imageAlignments)
    ? (raw.imageAlignments as Record<string, PageAlignment>)
    : {};
  const dateVisibility = isPlainObject(raw.dateVisibility)
    ? (raw.dateVisibility as Record<string, boolean>)
    : {};
  const rotations = sanitizeRotations(raw.rotations);
  const customOrdering = Array.isArray(raw.customOrdering)
    ? (raw.customOrdering as string[])
    : null;
  const pageAlignments = isPlainObject(raw.pageAlignments)
    ? (raw.pageAlignments as Record<number, PageAlignment>)
    : {};
  const pageLayoutModes = isPlainObject(raw.pageLayoutModes)
    ? (raw.pageLayoutModes as Record<number, "justified" | "collage">)
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
      heightFactors,
      imageAlignments,
      dateVisibility,
      rotations,
      customOrdering,
      pageAlignments,
      pageLayoutModes,
      cropPositions: sanitizeCropPositions(raw.cropPositions),
      blockerTexts: sanitizeStyledTextRecord(raw.blockerTexts),
      imageCaptionTexts: sanitizeStyledTextRecord(raw.imageCaptionTexts),
      blockerDrawings: sanitizeBlockerDrawings(raw.blockerDrawings),
      blockerMaps: sanitizeBlockerMaps(raw.blockerMaps),
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
    heightFactors,
    imageAlignments,
    dateVisibility,
    rotations,
    customOrdering,
    pageAlignments,
    pageLayoutModes,
    cropPositions: {},
    blockerTexts: {},
    imageCaptionTexts: {},
    blockerDrawings: {},
    blockerMaps: {},
    overlayElements: {},
    imageCaptions: captionsFromDescriptionPositions(raw.descriptionPositions),
    excludedAssetIds,
    titlePage: null,
    extraPages: [],
  };
}
