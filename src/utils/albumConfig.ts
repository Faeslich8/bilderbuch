/**
 * Konfigurations-Persistenz für immich-book (Phase 1).
 *
 * Diese Datei zentralisiert das, was bisher inline in PhotoGrid.tsx lag
 * (GlobalConfig/AlbumConfig, DEFAULT_GLOBAL_CONFIG, loadGlobalConfig,
 * saveGlobalConfig, loadAlbumConfig, saveAlbumConfig) und erweitert es um das
 * V2-Schema des Element-Modells:
 *
 *  - schemaVersion (Migration alter Bücher)
 *  - overlayElements: frei platzierte Nutzer-Elemente pro Seite, adressiert
 *    über eine STABILE Seiten-ID (nicht die volatile pageNumber)
 *  - imageCaptions: kanonische Bildbeschriftungen, aus den alten
 *    descriptionPositions migriert
 *
 * Rückwärtskompatibilität: `loadAlbumConfig` liefert weiterhin ein
 * `descriptionPositions`-Feld (aus imageCaptions abgeleitet), damit der
 * bestehende PhotoGrid-Renderer bis Phase 6 unverändert funktioniert.
 *
 * Siehe PHASE1-PageElement-Design.md.
 */

import type { PageElement, CaptionPosition } from "../types/pageElement";
import { migrateRawAlbumConfig } from "./migration";

export const CURRENT_SCHEMA_VERSION = 2 as const;

const GLOBAL_KEY = "immich-book-global-config";
const albumKey = (albumId: string) => `immich-book-config-${albumId}`;

/** Alte Beschriftungs-Position (Legacy-Feld descriptionPositions). */
export type Position = "bottom" | "top" | "left" | "right";
export type PageAlignment = "left" | "center" | "right";
/** Seitenhintergrund des ganzen Buchs. */
export type PageBackground = "white" | "cream" | "darkbrown";

/** Titelblatt-Inhalt (eigene, vorangestellte erste Seite). */
export interface TitlePageConfig {
  /** Data-URL des Titelfotos (optional). */
  imageSrc?: string;
  title: string;
  subtitle: string;
}

/** Zusätzliche, frei befüllbare Leerseite (Elemente via overlayElements[id]). */
export interface ExtraPage {
  id: string;
  /** Nach welcher Auto-Seiten-Nummer einsortiert; 0 = ganz vorne. */
  afterPage: number;
}

/**
 * Bildausschnitt eines Fotos.
 * - x/y: object-position in Prozent (50/50 = Mitte, Default).
 * - scale: Zoomfaktor (>= 1). >1 zoomt in das Bild hinein, sodass sich per x/y
 *   der sichtbare Ausschnitt verschieben lässt. Fehlt/1 = kein Zoom.
 */
export interface CropPosition {
  x: number;
  y: number;
  scale?: number;
}

/** Globale Standard-Einstellungen (identisch zum bisherigen Inline-Typ). */
export interface GlobalConfig {
  // Page settings
  pageSize: "A4" | "LETTER" | "A3" | "CUSTOM";
  orientation: "portrait" | "landscape";
  pageWidth: number;
  pageHeight: number;
  margin: number;
  combinePages: boolean;
  // Layout settings
  rowHeight: number;
  spacing: number;
  filterVideos: boolean;
  // Display settings
  showDates: boolean;
  showDescriptions: boolean;
  fontSize: number;
  // Seitenhintergrund (ganzes Buch)
  pageBackground: PageBackground;
}

/**
 * Kanonische, gespeicherte Beschriftung für ein (Auto-)Bild.
 * Text wird zur Laufzeit aus der Asset-Beschreibung abgeleitet, daher hier
 * nur Position/Stil. Migriert aus descriptionPositions.
 */
export interface StoredImageCaption {
  position: CaptionPosition;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
}

/**
 * Legacy-Laufzeitform, wie sie der bestehende PhotoGrid-Editor liest und beim
 * Speichern zusammenbaut (globale Felder + Anpassungen + descriptionPositions).
 * Bleibt bis Phase 6 die Schnittstelle zum Editor.
 */
export interface AlbumConfig extends GlobalConfig {
  customAspectRatios: Record<string, number>;
  customOrdering: string[] | null;
  descriptionPositions: Record<string, Position>;
  pageAlignments: Record<number, PageAlignment>;
  /** Asset-IDs, die aus dem Buch ausgeschlossen sind (bleiben in Immich). */
  excludedAssetIds: string[];
  /** Bildausschnitt je assetId (object-position in Prozent). */
  cropPositions: Record<string, CropPosition>;
}

/** Album-Konfiguration im neuen Format (V2). */
export interface AlbumConfigV2 extends GlobalConfig {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  // Auto-Layout-Anpassungen (unverändert übernommen)
  customAspectRatios: Record<string, number>;
  customOrdering: string[] | null;
  pageAlignments: Record<number, PageAlignment>;
  // NEU in V2:
  /** Nutzer-Elemente je STABILER Seiten-ID (siehe photoBoxToElement.computeStablePageId). */
  overlayElements: Record<string, PageElement[]>;
  /** Kanonische Bildbeschriftungen je assetId (migriert aus descriptionPositions). */
  imageCaptions: Record<string, StoredImageCaption>;
  /** Asset-IDs, die aus dem Buch ausgeschlossen sind (bleiben in Immich). */
  excludedAssetIds: string[];
  /** Optionales Titelblatt (eigene erste Seite); null = keins. */
  titlePage: TitlePageConfig | null;
  /** Zusätzliche Leerseiten, einsortiert über afterPage. */
  extraPages: ExtraPage[];
  /** Bildausschnitt je assetId (object-position in Prozent). */
  cropPositions: Record<string, CropPosition>;
}

/**
 * Laufzeit-Sicht, die der bestehende Renderer erwartet: V2 + abgeleitete
 * `descriptionPositions` (Kompatibilität bis Phase 6).
 */
export interface LoadedAlbumConfig extends AlbumConfigV2 {
  descriptionPositions: Record<string, Position>;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  pageSize: "CUSTOM",
  orientation: "portrait",
  pageWidth: 2515,
  pageHeight: 3260,
  margin: 118,
  combinePages: true,
  rowHeight: 994,
  spacing: 20,
  filterVideos: true,
  showDates: true,
  showDescriptions: true,
  fontSize: 12,
  pageBackground: "white",
};

/* ------------------------------------------------------------------ */
/* Mapping zwischen Legacy-Position und CaptionPosition.               */
/* ------------------------------------------------------------------ */

/** descriptionPositions (Legacy) -> kanonische CaptionPosition. */
export function positionToCaption(pos: Position): CaptionPosition {
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

/** CaptionPosition -> Legacy-Position (für die Kompatibilitäts-Sicht). */
export function captionToPosition(pos: CaptionPosition): Position {
  switch (pos) {
    case "above":
    case "overlay-top":
      return "top";
    case "left":
      return "left";
    case "right":
      return "right";
    case "below":
    case "overlay-bottom":
    default:
      return "bottom";
  }
}

function captionsToDescriptionPositions(
  captions: Record<string, StoredImageCaption>,
): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const [assetId, cap] of Object.entries(captions)) {
    const legacy = captionToPosition(cap.position);
    // Default "bottom" wurde im alten Code nie gespeichert -> auch hier weglassen.
    if (legacy !== "bottom") out[assetId] = legacy;
  }
  return out;
}

function descriptionPositionsToCaptions(
  positions: Record<string, Position>,
): Record<string, StoredImageCaption> {
  const out: Record<string, StoredImageCaption> = {};
  for (const [assetId, pos] of Object.entries(positions)) {
    if (pos === "bottom") continue; // Default -> keine Override-Caption
    out[assetId] = { position: positionToCaption(pos) };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Global config.                                                      */
/* ------------------------------------------------------------------ */

export function loadGlobalConfig(): GlobalConfig {
  try {
    const stored = localStorage.getItem(GLOBAL_KEY);
    if (stored) {
      return { ...DEFAULT_GLOBAL_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load global config:", e);
  }
  return DEFAULT_GLOBAL_CONFIG;
}

export function saveGlobalConfig(config: GlobalConfig) {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save global config:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Album config (mit Migration).                                       */
/* ------------------------------------------------------------------ */

/**
 * Lädt die Album-Konfiguration, migriert sie bei Bedarf auf V2 und schreibt
 * die migrierte Form sofort zurück (gleiches Muster wie die bisherige
 * removeItem-Aufräumlogik beim Mount).
 */
export function loadAlbumConfig(albumId: string): LoadedAlbumConfig {
  const globalConfig = loadGlobalConfig();
  let raw: unknown = null;
  try {
    const stored = localStorage.getItem(albumKey(albumId));
    if (stored) raw = JSON.parse(stored);
  } catch (e) {
    console.error("Failed to load album config:", e);
  }

  const v2 = migrateRawAlbumConfig(raw, globalConfig);

  // Falls migriert wurde (oder neu angelegt), kanonische Form zurückschreiben.
  try {
    localStorage.setItem(albumKey(albumId), JSON.stringify(v2));
  } catch (e) {
    console.error("Failed to persist migrated album config:", e);
  }

  return {
    ...v2,
    descriptionPositions: captionsToDescriptionPositions(v2.imageCaptions),
  };
}

/**
 * Speichert die Album-Konfiguration. Akzeptiert die Laufzeit-Sicht des
 * bestehenden Editors (inkl. descriptionPositions) und persistiert die
 * kanonische V2-Form (imageCaptions). overlayElements werden unverändert
 * durchgereicht.
 */
export function saveAlbumConfig(
  albumId: string,
  config: AlbumConfig &
    Partial<
      Pick<
        AlbumConfigV2,
        "overlayElements" | "imageCaptions" | "titlePage" | "extraPages"
      >
    >,
) {
  try {
    // imageCaptions: bevorzugt explizit gesetzte, sonst aus descriptionPositions ableiten.
    const imageCaptions =
      config.imageCaptions ??
      descriptionPositionsToCaptions(config.descriptionPositions ?? {});

    const v2: AlbumConfigV2 = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pageSize: config.pageSize,
      orientation: config.orientation,
      pageWidth: config.pageWidth,
      pageHeight: config.pageHeight,
      margin: config.margin,
      combinePages: config.combinePages,
      rowHeight: config.rowHeight,
      spacing: config.spacing,
      filterVideos: config.filterVideos,
      showDates: config.showDates,
      showDescriptions: config.showDescriptions,
      fontSize: config.fontSize,
      pageBackground: config.pageBackground,
      customAspectRatios: config.customAspectRatios ?? {},
      customOrdering: config.customOrdering ?? null,
      pageAlignments: config.pageAlignments ?? {},
      cropPositions: config.cropPositions ?? {},
      overlayElements: config.overlayElements ?? {},
      imageCaptions,
      excludedAssetIds: config.excludedAssetIds ?? [],
      titlePage: config.titlePage ?? null,
      extraPages: config.extraPages ?? [],
    };

    localStorage.setItem(albumKey(albumId), JSON.stringify(v2));

    // Globale Defaults wie bisher mitschreiben.
    saveGlobalConfig({
      pageSize: config.pageSize,
      orientation: config.orientation,
      pageWidth: config.pageWidth,
      pageHeight: config.pageHeight,
      margin: config.margin,
      combinePages: config.combinePages,
      rowHeight: config.rowHeight,
      spacing: config.spacing,
      filterVideos: config.filterVideos,
      showDates: config.showDates,
      showDescriptions: config.showDescriptions,
      fontSize: config.fontSize,
      pageBackground: config.pageBackground,
    });
  } catch (e) {
    console.error("Failed to save album config:", e);
  }
}
