/**
 * Automatische Seitengestaltung.
 *
 * Bewusst KEINE Cloud-KI und kein mitgeliefertes neuronales Netz: Das erste
 * würde Fotos aus dem Haus schicken (und damit das Kernversprechen brechen), das
 * zweite die App um zweistellige Megabytes aufblähen und Arbeit doppeln, die
 * Immich längst erledigt hat.
 *
 * Stattdessen werden die BEREITS VORHANDENEN Erkennungsergebnisse von Immich
 * ausgewertet — Gesichts-Bounding-Boxen, Favoriten, Bewertungen, Aufnahmezeit,
 * Ort — kombiniert mit klassischer Heuristik. Für lokale Alben (ohne Immich)
 * greift ein Rückfall auf Maße und Seitenverhältnis, sodass die Funktion dort
 * ebenfalls etwas Sinnvolles tut, nur weniger treffsicher.
 *
 * Das Ergebnis ist ein Plan aus Werten, die das bestehende Konfigurationsmodell
 * ohnehin kennt (Reihenfolge, Höhenfaktoren, Seitenmodi) plus Seitenumbrüchen.
 * Es wird also nichts "magisch" gerendert — der Plan ist danach ganz normal von
 * Hand weiter bearbeitbar.
 */

import type { AssetResponseDto } from "@immich/sdk";
import { thumbHashToAverageRGBA } from "thumbhash";
import type { Page } from "./pageLayout";

/** Zeitlicher Abstand, ab dem eine neue Szene beginnt. */
const SCENE_GAP_MS = 30 * 60 * 1000;
/**
 * Untergrenze, ab wie vielen Fotos eine Szene eine eigene Seite bekommt. Der
 * Aufrufer reicht einen zur Seitengroesse passenden Wert herein (siehe
 * planDesign); dieser Wert ist nur der Rueckfall.
 */
const DEFAULT_MIN_PHOTOS_FOR_OWN_PAGE = 3;

export interface PhotoSignals {
  id: string;
  /** Breite/Höhe, EXIF-Orientierung berücksichtigt. */
  aspect: number;
  /** Aufnahmezeitpunkt in ms (0 = unbekannt). */
  takenAt: number;
  /** 0..1, relativ zum stärksten Foto des Albums. */
  importance: number;
  hasFaces: boolean;
  /** Mittlere Farbe (aus dem thumbhash), falls vorhanden. */
  color: { r: number; g: number; b: number } | null;
  place: string | null;
}

export interface DesignPlan {
  ordering: string[];
  heightFactors: Record<string, number>;
  /** Asset-Ids, vor denen eine neue Seite beginnt. */
  pageBreakBefore: string[];
  stats: {
    photos: number;
    scenes: number;
    highlighted: number;
    /** Wie viele Signale aus Immich kamen (Gesichter/Favoriten/Bewertung). */
    withImmichSignals: number;
  };
}

/* ------------------------------------------------------------------ */
/* Analyse                                                             */
/* ------------------------------------------------------------------ */

function aspectOf(a: AssetResponseDto): number {
  const w = a.exifInfo?.exifImageWidth || 1;
  const h = a.exifInfo?.exifImageHeight || 1;
  return a.exifInfo?.orientation === "6" ? h / w : w / h;
}

function faceCount(a: AssetResponseDto): number {
  const named = a.people?.reduce((n, p) => n + (p.faces?.length ?? 0), 0) ?? 0;
  return named + (a.unassignedFaces?.length ?? 0);
}

/** Mittlere Farbe aus dem thumbhash – ohne das Bild zu laden. */
function averageColor(a: AssetResponseDto): PhotoSignals["color"] {
  const hash = a.thumbhash;
  if (!hash) return null;
  try {
    const bin = atob(hash);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const { r, g, b } = thumbHashToAverageRGBA(bytes);
    return { r: r * 255, g: g * 255, b: b * 255 };
  } catch {
    return null;
  }
}

/**
 * Rohbewertung der Wichtigkeit. Immich-Signale wiegen am schwersten, weil sie
 * die Einschätzung des Nutzers bzw. echte Erkennung widerspiegeln; die
 * Maß-Heuristik ist nur der Rückfall für lokale Alben.
 */
function rawImportance(a: AssetResponseDto): number {
  let s = 0;
  if (a.isFavorite) s += 3;
  const rating = a.exifInfo?.rating ?? 0;
  if (rating > 0) s += Math.min(5, rating);
  const faces = faceCount(a);
  if (faces > 0) s += 2 + Math.min(1, (faces - 1) * 0.5);
  if (a.exifInfo?.description) s += 1;

  // Rückfall-Signale, die auch ohne Immich funktionieren:
  const mp =
    ((a.exifInfo?.exifImageWidth || 0) * (a.exifInfo?.exifImageHeight || 0)) /
    1_000_000;
  s += Math.min(1.5, mp / 8);
  const ar = aspectOf(a);
  // Ausgeprägte Panoramen und Hochformate wirken im Buch stärker.
  if (ar >= 2 || ar <= 0.5) s += 1;
  return s;
}

export function collectSignals(assets: AssetResponseDto[]): PhotoSignals[] {
  const raw = assets.map(rawImportance);
  const max = Math.max(1, ...raw);
  return assets.map((a, i) => ({
    id: a.id,
    aspect: aspectOf(a),
    takenAt: a.fileCreatedAt ? new Date(a.fileCreatedAt).getTime() : 0,
    importance: raw[i] / max,
    hasFaces: faceCount(a) > 0,
    color: averageColor(a),
    place: a.exifInfo?.city ?? a.exifInfo?.country ?? null,
  }));
}

/** Hat das Album überhaupt auswertbare Immich-Signale? */
export function immichSignalCount(assets: AssetResponseDto[]): number {
  return assets.filter(
    (a) =>
      a.isFavorite ||
      (a.exifInfo?.rating ?? 0) > 0 ||
      faceCount(a) > 0 ||
      !!a.exifInfo?.description,
  ).length;
}

/* ------------------------------------------------------------------ */
/* Planung                                                             */
/* ------------------------------------------------------------------ */

/**
 * Szenen bilden: neue Szene bei größerer zeitlicher Lücke oder Ortswechsel.
 * Die zeitliche Reihenfolge bleibt dabei erhalten — ein Fotobuch erzählt in der
 * Regel chronologisch, ein Umsortieren nach Farbe o. Ä. würde die Erzählung
 * zerstören.
 */
function buildScenes(signals: PhotoSignals[]): PhotoSignals[][] {
  const sorted = [...signals].sort((a, b) => {
    if (a.takenAt && b.takenAt) return a.takenAt - b.takenAt;
    return 0;
  });
  const scenes: PhotoSignals[][] = [];
  let current: PhotoSignals[] = [];
  let prev: PhotoSignals | null = null;

  for (const s of sorted) {
    const gap =
      prev && prev.takenAt && s.takenAt ? s.takenAt - prev.takenAt : 0;
    const placeChanged =
      prev && prev.place && s.place && prev.place !== s.place;
    if (current.length > 0 && (gap > SCENE_GAP_MS || placeChanged)) {
      scenes.push(current);
      current = [];
    }
    current.push(s);
    prev = s;
  }
  if (current.length > 0) scenes.push(current);
  return scenes;
}

/**
 * Erstellt den Gestaltungsplan: Reihenfolge (chronologisch, in Szenen),
 * hervorgehobene Fotos als hohe Kacheln und Seitenumbrüche an Szenengrenzen.
 */
export function planDesign(
  assets: AssetResponseDto[],
  opts: { keepOrder?: boolean; minPhotosForOwnPage?: number } = {},
): DesignPlan {
  const signals = collectSignals(assets);
  const scenes = buildScenes(signals);

  // Reihenfolge: entweder die bestehende beibehalten oder chronologisch neu.
  const ordering = opts.keepOrder
    ? assets.map((a) => a.id)
    : scenes.flat().map((s) => s.id);

  // Hohe Kacheln nur für hervorstechende HOCHFORMATE – bei Querformaten bringt
  // eine hohe Kachel nichts, sie würde nur stark beschnitten.
  const byImportance = [...signals].sort((a, b) => b.importance - a.importance);
  const topCount = Math.max(1, Math.round(signals.length * 0.15));
  const heightFactors: Record<string, number> = {};
  let highlighted = 0;
  for (const s of byImportance.slice(0, topCount)) {
    if (s.aspect < 0.95 && s.importance >= 0.6) {
      heightFactors[s.id] = 2;
      highlighted++;
    }
  }

  // Seitenumbrüche nur vor Szenen, die eine eigene Seite auch füllen —
  // sonst entstünden viele fast leere Seiten.
  // Eine Szene bekommt nur dann eine eigene Seite, wenn sie diese auch
  // einigermassen fuellt - sonst entstuenden viele fast leere Seiten.
  const minForOwnPage = Math.max(
    2,
    opts.minPhotosForOwnPage ?? DEFAULT_MIN_PHOTOS_FOR_OWN_PAGE,
  );
  const pageBreakBefore: string[] = [];
  if (!opts.keepOrder) {
    let idx = 0;
    for (const scene of scenes) {
      if (idx > 0 && scene.length >= minForOwnPage) {
        pageBreakBefore.push(scene[0].id);
      }
      idx += scene.length;
    }
  }

  return {
    ordering,
    heightFactors,
    pageBreakBefore,
    stats: {
      photos: assets.length,
      scenes: scenes.length,
      highlighted,
      withImmichSignals: immichSignalCount(assets),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Seitenmodus je Seite                                                */
/* ------------------------------------------------------------------ */

/** Farbliche Streuung einer Seite (0 = einfarbig, 1 = sehr bunt gemischt). */
function colorSpread(ids: string[], byId: Map<string, PhotoSignals>): number {
  const cols = ids
    .map((id) => byId.get(id)?.color)
    .filter((c): c is { r: number; g: number; b: number } => !!c);
  if (cols.length < 2) return 0;
  const mean = cols.reduce(
    (acc, c) => ({ r: acc.r + c.r / cols.length, g: acc.g + c.g / cols.length, b: acc.b + c.b / cols.length }),
    { r: 0, g: 0, b: 0 },
  );
  const avgDist =
    cols.reduce(
      (sum, c) =>
        sum +
        Math.sqrt(
          (c.r - mean.r) ** 2 + (c.g - mean.g) ** 2 + (c.b - mean.b) ** 2,
        ),
      0,
    ) / cols.length;
  // 110 entspricht etwa "deutlich unterschiedliche Farbwelten".
  return Math.min(1, avgDist / 110);
}

/**
 * Entscheidet je Seite zwischen Raster und Collage.
 *
 * Collage lohnt sich, wenn eine Seite viele Hochformate mischt (dort entstehen
 * die charakteristischen hohen Kacheln) oder wenn sie farblich sehr bunt ist —
 * dann wirkt die unruhigere Anordnung lebendig statt beliebig. Ruhige,
 * gleichförmige Seiten bleiben im Raster.
 */
export function choosePageModes(
  pages: Page[],
  signals: PhotoSignals[],
): Record<number, "justified" | "collage"> {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const modes: Record<number, "justified" | "collage"> = {};

  for (const page of pages) {
    const ids = page.photos.map((p) => p.asset.id);
    if (ids.length < 3) continue; // zu wenig für eine Collage

    const portraits = ids.filter((id) => (byId.get(id)?.aspect ?? 1) < 0.95).length;
    const portraitShare = portraits / ids.length;
    const hasTall = ids.some(
      (id) => (byId.get(id)?.importance ?? 0) >= 0.6 && (byId.get(id)?.aspect ?? 1) < 0.95,
    );
    const spread = colorSpread(ids, byId);

    if (portraitShare >= 0.4 || hasTall || spread >= 0.65) {
      modes[page.pageNumber] = "collage";
    }
  }
  return modes;
}

