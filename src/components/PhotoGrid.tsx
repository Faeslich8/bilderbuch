import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  getAlbumInfo,
  getAllAlbums,
  searchAssets,
  AssetTypeEnum,
  type AlbumResponseDto,
  type AssetResponseDto,
} from "@immich/sdk";
import {
  PDFViewer,
  Document,
  Page,
  View,
  Text,
  Image as PdfImage,
  StyleSheet,
  Font,
  Svg,
  Defs,
  LinearGradient,
  Stop,
  Rect,
  Path,
} from "@react-pdf/renderer";
import {
  calculatePageLayout,
  calculateCollageLayout,
  calculateBookLayoutPerPage,
  PAGE_SIZES,
  type PageAlignment,
  type PhotoBox,
} from "../utils/pageLayout";
import {
  loadAlbumConfig,
  saveAlbumConfig,
  type Position,
  type AlbumConfig,
  type PageBackground,
  type TitlePageConfig,
  type ExtraPage,
  type CropPosition,
  type StyledText,
  type DrawStroke,
  type MapConfig,
} from "../utils/albumConfig";
import { toPoints, screenToLayoutPx } from "../utils/units";
import { randomId } from "../utils/id";
import MapBlockerView, { type GeoPoint } from "./MapBlockerView";
import {
  PdfElement,
  PdfEmojiElement,
  PdfShapeElement,
  PdfTextElement,
  WebElement,
  WebEmojiElement,
  WebShapeElement,
  WebTextElement,
  createDynamicStyles,
  createWebStyles,
  elementBoxStyle,
} from "./ElementRenderer";
import { photoBoxToImageElement } from "../utils/photoBoxToElement";
import { planDesign, collectSignals, choosePageModes } from "../utils/autoDesign";
import BookPresenter from "./BookPresenter";
import { localMediaUrl } from "../utils/remoteStore";
import {
  isLocalAlbumId,
  loadLocalAlbum,
  addPhotosToLocalAlbum,
  addDataUrlToLocalAlbum,
  localAlbumAssets,
  addImmichAssetsToLocalAlbum,
} from "../utils/localAlbum";
import {
  createEmojiElement,
  createImageElement,
  createShapeElement,
  createTextElement,
  isEmojiElement,
  isImageElement,
  isShapeElement,
  isTextElement,
  type BaseElement,
  type ImageElement,
  type PageElement,
  type ShapeElement,
  type TextElement,
} from "../types/pageElement";
import Moveable from "react-moveable";
import type { ImmichConfig } from "./ConnectionForm";
import roboto400 from "@fontsource/roboto/files/roboto-latin-400-normal.woff?url";
import roboto500 from "@fontsource/roboto/files/roboto-latin-500-normal.woff?url";
import roboto700 from "@fontsource/roboto/files/roboto-latin-700-normal.woff?url";
import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff?url";
import lora700 from "@fontsource/lora/files/lora-latin-700-normal.woff?url";
import robotoMono400 from "@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url";
import robotoMono700 from "@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url";
import greatVibes400 from "@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff?url";
import Icon from "@mdi/react";
import {
  mdiFormatAlignLeft,
  mdiFormatAlignCenter,
  mdiFormatAlignRight,
  mdiTrashCanOutline,
  mdiFilePlusOutline,
  mdiFileDownloadOutline,
  mdiPencil,
  mdiPlus,
  mdiChevronDown,
  mdiChevronLeft,
  mdiCogOutline,
  mdiViewGridOutline,
  mdiFileOutline,
  mdiBookOpenOutline,
  mdiImagePlusOutline,
  mdiImageMultipleOutline,
  mdiFormatText,
  mdiShapePlusOutline,
  mdiEmoticonOutline,
  mdiFileDocumentPlusOutline,
  mdiVectorRectangle,
  mdiBookOpenPageVariantOutline,
  mdiCropRotate,
  mdiCalendarOutline,
  mdiRotateRight,
  mdiAutoFix,
  mdiPresentationPlay,
  mdiUndoVariant,
  mdiImageEditOutline,
  mdiClose,
  mdiMapMarkerOutline,
  mdiCursorMove,
} from "@mdi/js";

// Register fonts for PDF using local bundled files
Font.register({
  family: "Roboto",
  fonts: [
    { src: roboto400, fontWeight: 400 },
    { src: roboto500, fontWeight: 500 },
    { src: roboto700, fontWeight: 700 },
  ],
});
Font.register({
  family: "Lora",
  fonts: [
    { src: lora400, fontWeight: 400 },
    { src: lora700, fontWeight: 700 },
  ],
});
Font.register({
  family: "Roboto Mono",
  fonts: [
    { src: robotoMono400, fontWeight: 400 },
    { src: robotoMono700, fontWeight: 700 },
  ],
});
// Great Vibes gibt es nur in einem Schnitt. Damit eine Anfrage nach halbfett
// oder fett im PDF nicht ins Leere läuft, wird derselbe Schnitt für alle drei
// Gewichte hinterlegt – Schreibschriften haben typischerweise keinen Fettschnitt.
Font.register({
  family: "Great Vibes",
  fonts: [
    { src: greatVibes400, fontWeight: 400 },
    { src: greatVibes400, fontWeight: 500 },
    { src: greatVibes400, fontWeight: 700 },
  ],
});

// Auswählbare Schriftfamilien (Web-Vorschau UND PDF-Export identisch).
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Sans", value: "Roboto" },
  { label: "Serif", value: "Lora" },
  { label: "Mono", value: "Roboto Mono" },
  { label: "Schreibschrift", value: "Great Vibes" },
];

// Farb-Emoji im PDF: jedes Emoji wird zur PDF-Zeit per Canvas aus der OS-Emoji-Schrift
// in eine PNG-Data-URL gerendert — farbig, offline, ohne gebündelte Dateien, volle Abdeckung.
const emojiPngCache = new Map<string, string>();
function emojiToPngDataUrl(code: string): string {
  const cached = emojiPngCache.get(code);
  if (cached !== undefined) return cached;
  const emoji = String.fromCodePoint(
    ...code.split("-").map((h) => parseInt(h, 16)),
  );
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  let url = "";
  if (ctx) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.floor(size * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
    url = canvas.toDataURL("image/png");
  }
  emojiPngCache.set(code, url);
  return url;
}
Font.registerEmojiSource({
  builder: emojiToPngDataUrl,
  withVariationSelectors: true,
});

interface PhotoGridProps {
  immichConfig: ImmichConfig;
  album: AlbumResponseDto;
  onBack: () => void;
}

// Static styles for the PDF (page background only; element styles live in ElementRenderer)
const staticStyles = StyleSheet.create({
  page: {
    backgroundColor: "white",
  },
});

// A "Leerraum" (blocker) participates in the auto layout like a photo but renders as
// empty design space. Identified by an id prefix; carries no real asset.
const BLOCKER_PREFIX = "blocker:";

// Common emojis offered by the "+ Emoji" picker (Phase 7).
const EMOJI_PALETTE = [
  "😀", "😄", "😍", "🥳", "😎", "🤩", "😢", "😡",
  "👍", "👎", "👏", "🙌", "💪", "🙏", "❤️", "⭐",
  "✨", "🔥", "🎉", "🎂", "🎁", "🌸", "🌈", "☀️",
  "🍀", "🐶", "🐱", "📷",
];

// Seitenhintergrund-Farben (ganzes Buch, identisch in Web + PDF).
const PAGE_BG: Record<PageBackground, string> = {
  white: "#ffffff",
  cream: "#f4ecd8",
  darkbrown: "#2a1b0f",
};

// Web-Hintergrund inkl. dezentem Pergament-Verlauf bei Creme.
const webPageBackgroundStyle = (bg: PageBackground) =>
  bg === "cream"
    ? {
        backgroundColor: PAGE_BG.cream,
        backgroundImage:
          "radial-gradient(circle at 22% 18%, rgba(124,94,46,0.06), transparent 55%), radial-gradient(circle at 82% 80%, rgba(124,94,46,0.07), transparent 55%)",
      }
    : { backgroundColor: PAGE_BG[bg] };

// Seitenmaße-Eingabe in cm (intern px @ 300 DPI).
const pxToCm = (px: number) => Math.round((px / 300) * 2.54 * 10) / 10;
const cmToPx = (cm: number) => Math.round((cm / 2.54) * 300);
const mmToPx = (mm: number) => Math.round((mm / 25.4) * 300);

// Farb-/Breiten-Presets für die Zeichenzonen.
const PEN_COLORS = ["#1c1917", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#ffffff"];
const PEN_WIDTHS = [1.5, 3, 6, 10];

// Einen Freihand-Strich (normalisierte Punkte 0..1) in ein SVG-Path-`d` mit
// konkreten Maßen (w×h) übersetzen. Identisch für Web-SVG und react-pdf.
const strokeToPath = (pts: number[], w: number, h: number): string => {
  if (pts.length < 2) return "";
  let d = "";
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = (pts[i] * w).toFixed(1);
    const y = (pts[i + 1] * h).toFixed(1);
    d += (i === 0 ? "M" : "L") + x + " " + y + " ";
  }
  // Einzelpunkt -> winziges Segment, damit ein Punkt sichtbar wird.
  if (pts.length === 2) d += "L" + (pts[0] * w + 0.1).toFixed(1) + " " + (pts[1] * h).toFixed(1);
  return d.trim();
};

// DIN-A-Formate in mm (Hochformat, Breite × Höhe).
const DIN_FORMATS: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
};

// px-Maße für ein DIN-Format in der gewünschten Orientierung.
const dinToPx = (
  format: keyof typeof DIN_FORMATS,
  landscape: boolean,
): { width: number; height: number } => {
  const [w, h] = DIN_FORMATS[format];
  return {
    width: mmToPx(landscape ? h : w),
    height: mmToPx(landscape ? w : h),
  };
};

// Aus px-Maßen das passende DIN-Format ableiten (±2 px Toleranz), sonst "custom".
const detectDinFormat = (width: number, height: number): string => {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  for (const [name, [wmm, hmm]] of Object.entries(DIN_FORMATS)) {
    if (
      Math.abs(short - mmToPx(wmm)) <= 3 &&
      Math.abs(long - mmToPx(hmm)) <= 3
    )
      return name;
  }
  return "custom";
};

// Externe Bilddatei -> herunterskalierte Data-URL (für lokale Einbettung im Buch).
async function fileToImageElementData(
  file: File,
  maxEdge = 1600,
): Promise<{ src: string; width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { src: dataUrl, width: img.width, height: img.height };
  ctx.drawImage(img, 0, 0, w, h);
  return {
    src: canvas.toDataURL("image/jpeg", 0.85),
    width: img.width,
    height: img.height,
  };
}
const isBlocker = (id: string): boolean => id.startsWith(BLOCKER_PREFIX);

// Placeholder asset so a blocker flows through calculatePageLayout. The 1:1 default
// ratio is overridden by customAspectRatios, so the edge-drag handles resize it.
const blockerAsset = (id: string): AssetResponseDto =>
  ({
    id,
    type: "IMAGE",
    originalFileName: "Leerraum",
    exifInfo: { exifImageWidth: 1000, exifImageHeight: 1000 },
  }) as unknown as AssetResponseDto;

function PhotoGrid({ immichConfig, album, onBack }: PhotoGridProps) {
  const [assets, setAssets] = useState<AssetResponseDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "pdf">("preview");

  // Load config on mount
  const initialConfig = useMemo(() => loadAlbumConfig(album.id), [album.id]);

  // Page settings
  const [pageSize, _setPageSize] = useState<"A4" | "LETTER" | "A3" | "CUSTOM">(
    initialConfig.pageSize,
  );
  const [orientation, _setOrientation] = useState<"portrait" | "landscape">(
    initialConfig.orientation,
  );
  const [pageWidth, setPageWidth] = useState(initialConfig.pageWidth);
  const [pageHeight, setPageHeight] = useState(initialConfig.pageHeight);
  const [margin, setMargin] = useState(initialConfig.margin);
  const [combinePages, setCombinePages] = useState(initialConfig.combinePages);

  // Layout settings
  const [rowHeight, setRowHeight] = useState(initialConfig.rowHeight);
  const [spacing, setSpacing] = useState(initialConfig.spacing);
  const [filterVideos, setFilterVideos] = useState(initialConfig.filterVideos);

  // Validation helpers
  const isPageWidthValid = pageWidth >= 1000 && pageWidth <= 10000;
  const isPageHeightValid = pageHeight >= 1000 && pageHeight <= 10000;
  const isMarginValid = margin >= 0 && margin <= pageWidth / 2;
  const isRowHeightValid = rowHeight >= 300 && rowHeight <= pageHeight;
  const isSpacingValid = spacing >= 0 && spacing <= 100;

  // Clamped values for use in layout calculations (prevent crashes from invalid values)
  const validPageWidth = isPageWidthValid
    ? pageWidth
    : Math.max(1000, Math.min(10000, pageWidth));
  const validPageHeight = isPageHeightValid
    ? pageHeight
    : Math.max(1000, Math.min(10000, pageHeight));
  const validMargin = isMarginValid
    ? margin
    : Math.max(0, Math.min(validPageWidth / 2, margin));
  const validRowHeight = isRowHeightValid
    ? rowHeight
    : Math.max(300, Math.min(validPageHeight, rowHeight));
  const validSpacing = isSpacingValid
    ? spacing
    : Math.max(0, Math.min(100, spacing));

  // Display settings
  const [showDates, setShowDates] = useState(initialConfig.showDates);
  const [showDescriptions, setShowDescriptions] = useState(
    initialConfig.showDescriptions,
  );
  const [fontSize, setFontSize] = useState(initialConfig.fontSize);
  const [pageBackground, setPageBackground] = useState(
    initialConfig.pageBackground,
  );
  const [titlePage, setTitlePage] = useState<TitlePageConfig | null>(
    initialConfig.titlePage,
  );
  const [extraPages, setExtraPages] = useState<ExtraPage[]>(
    initialConfig.extraPages,
  );

  // Create dynamic styles based on current fontSize
  const pdfStyles = useMemo(() => createDynamicStyles(fontSize), [fontSize]);
  const webStyles = useMemo(() => createWebStyles(fontSize), [fontSize]);

  // Layout-Modus (justified/collage) und Collage-Höhenfaktoren je Foto.
  const [layoutMode, setLayoutMode] = useState<"justified" | "collage">(
    initialConfig.layoutMode,
  );
  const [heightFactors, setHeightFactors] = useState<Map<string, number>>(
    () => new Map(Object.entries(initialConfig.heightFactors)),
  );
  // Ausrichtung einzelner Fotos im freien Platz ihrer Zeile.
  const [imageAlignments, setImageAlignments] = useState<
    Map<string, PageAlignment>
  >(() => new Map(Object.entries(initialConfig.imageAlignments)));
  // Datumsanzeige je Foto (Override; ohne Eintrag gilt das globale showDates).
  const [rotations, setRotations] = useState<Map<string, number>>(
    () => new Map(Object.entries(initialConfig.rotations)),
  );
  // Seitenumbrüche der automatischen Gestaltung (vor diesen Fotos beginnt eine Seite).
  const [pageBreakBefore, setPageBreakBefore] = useState<Set<string>>(
    () => new Set(initialConfig.pageBreakBefore),
  );
  // Momentaufnahme vor der letzten automatischen Gestaltung – für ein Rückgängig.
  const [designUndo, setDesignUndo] = useState<{
    ordering: string[] | null;
    heightFactors: Map<string, number>;
    pageLayoutModes: Map<number, "justified" | "collage">;
    pageBreakBefore: Set<string>;
  } | null>(null);
  const [designNote, setDesignNote] = useState<string | null>(null);
  // Vollbild-Praesentation (Blaettern am Fernseher/Tablet).
  const [presenting, setPresenting] = useState(false);
  const [dateVisibility, setDateVisibility] = useState<Map<string, boolean>>(
    () => new Map(Object.entries(initialConfig.dateVisibility)),
  );
  // Layout-Modus je logischer Seite (Override; sonst gilt layoutMode).
  const [pageLayoutModes, setPageLayoutModes] = useState<
    Map<number, "justified" | "collage">
  >(
    () =>
      new Map(
        Object.entries(initialConfig.pageLayoutModes).map(([k, v]) => [
          Number(k),
          v,
        ]),
      ),
  );

  // Customizations
  const [customAspectRatios, setCustomAspectRatios] = useState<
    Map<string, number>
  >(() => new Map(Object.entries(initialConfig.customAspectRatios)));
  const [customOrdering, setCustomOrdering] = useState<string[] | null>(
    initialConfig.customOrdering,
  );
  const [descriptionPositions, setDescriptionPositions] = useState<
    Map<string, Position>
  >(() => new Map(Object.entries(initialConfig.descriptionPositions)));
  const [pageAlignments, setPageAlignments] = useState<
    Map<number, PageAlignment>
  >(
    () =>
      new Map(
        Object.entries(initialConfig.pageAlignments).map(([k, v]) => [
          Number(k),
          v,
        ]),
      ),
  );
  const [cropPositions, setCropPositions] = useState<
    Map<string, CropPosition>
  >(() => new Map(Object.entries(initialConfig.cropPositions)));
  // Welches Foto sich gerade im Crop-Modus befindet (Bildausschnitt per Drag anpassen).
  const [croppingAssetId, setCroppingAssetId] = useState<string | null>(null);
  // Freitext (mit Stil) in Leerräumen (Blocker) je Blocker-Id.
  const [blockerTexts, setBlockerTexts] = useState<Map<string, StyledText>>(
    () => new Map(Object.entries(initialConfig.blockerTexts)),
  );
  // Welcher Leerraum gerade bearbeitet wird (Doppelklick zum Editieren).
  const [editingBlockerId, setEditingBlockerId] = useState<string | null>(null);
  // Freihand-Zeichnungen je Leerraum (Stift/Touch/Maus).
  const [blockerDrawings, setBlockerDrawings] = useState<
    Map<string, DrawStroke[]>
  >(() => new Map(Object.entries(initialConfig.blockerDrawings)));
  // Karten-Leerräume (Blocker mit Karte) je Blocker-Id.
  const [blockerMaps, setBlockerMaps] = useState<Map<string, MapConfig>>(
    () => new Map(Object.entries(initialConfig.blockerMaps)),
  );
  // Welcher Leerraum gerade im Zeichenmodus ist.
  const [drawingBlockerId, setDrawingBlockerId] = useState<string | null>(null);
  // Aktueller Stift (Farbe/Breite) und der gerade gezogene Strich.
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1]);
  const [liveStroke, setLiveStroke] = useState<number[] | null>(null);
  // Eigene Bildunterschrift (mit Stil) je assetId.
  const [imageCaptionTexts, setImageCaptionTexts] = useState<
    Map<string, StyledText>
  >(() => new Map(Object.entries(initialConfig.imageCaptionTexts)));
  // Welche Bildunterschrift gerade bearbeitet wird.
  const [editingCaptionAssetId, setEditingCaptionAssetId] = useState<
    string | null
  >(null);

  // Drag state for reordering
  const [reorderDragState, setReorderDragState] = useState<{
    draggedAssetId: string;
    draggedIndex: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  // Auf welcher Seite der Zielkachel eingefügt wird: false = links davor,
  // true = rechts dahinter (folgt der Cursor-Hälfte).
  const [dropAfter, setDropAfter] = useState(false);

  // Drag state for aspect ratio adjustment (horizontal edges = width,
  // vertical edges = height; beides ändert das Seitenverhältnis).
  const [aspectDragState, setAspectDragState] = useState<{
    assetId: string;
    edge: "left" | "right" | "top" | "bottom";
    startX: number;
    startY: number;
    originalAspectRatio: number;
    originalX: number;
    originalWidth: number;
    originalHeight: number;
  } | null>(null);

  // Drag state for crop (object-position) adjustment
  const [cropDragState, setCropDragState] = useState<{
    assetId: string;
    startX: number;
    startY: number;
    originalX: number;
    originalY: number;
    boxWidth: number;
    boxHeight: number;
  } | null>(null);

  // Phase 3: free-form overlay elements per stable page id (Phase-1 store, now live)
  const [overlayElements, setOverlayElements] = useState<
    Record<string, PageElement[]>
  >(initialConfig.overlayElements);

  // Asset ids "unlocked" into free manual elements (excluded from the auto layout).
  const manualizedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const els of Object.values(overlayElements)) {
      for (const el of els) {
        if (isImageElement(el) && el.source === "manual") ids.add(el.assetId);
      }
    }
    return ids;
  }, [overlayElements]);

  // Phase 3: which overlay element is selected, and the DOM target for its handles.
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [moveableTarget, setMoveableTarget] = useState<HTMLElement | null>(
    null,
  );
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Aufgeräumte Toolbar: Einfügen-Menü + Seiten-Übersicht.
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [widthCmInput, setWidthCmInput] = useState(
    String(pxToCm(initialConfig.pageWidth)),
  );
  const [heightCmInput, setHeightCmInput] = useState(
    String(pxToCm(initialConfig.pageHeight)),
  );

  // Seitenmaße setzen (px + cm-Felder synchron halten).
  const applyPageSize = (width: number, height: number) => {
    setPageWidth(width);
    setPageHeight(height);
    setWidthCmInput(String(pxToCm(width)));
    setHeightCmInput(String(pxToCm(height)));
  };
  const currentDinFormat = detectDinFormat(pageWidth, pageHeight);
  const isLandscape = pageWidth > pageHeight;

  // Images removed from the book (kept in Immich); plus the restore-panel toggle.
  const [excludedAssetIds, setExcludedAssetIds] = useState<Set<string>>(
    () => new Set(initialConfig.excludedAssetIds),
  );
  const [showExcludedPanel, setShowExcludedPanel] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const handleExcludeAsset = (id: string) =>
    setExcludedAssetIds((prev) => new Set(prev).add(id));
  const handleRestoreAsset = (id: string) =>
    setExcludedAssetIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // Update page dimensions when size or orientation changes
  useEffect(() => {
    if (pageSize !== "CUSTOM") {
      const dimensions = PAGE_SIZES[pageSize][orientation];
      setPageWidth(dimensions.width);
      setPageHeight(dimensions.height);
    }
  }, [pageSize, orientation]);

  useEffect(() => {
    loadAlbumAssets();

    // Clean up old localStorage keys (migration)
    localStorage.removeItem(`immich-book-aspect-ratios-${album.id}`);
    localStorage.removeItem(`immich-book-ordering-${album.id}`);
    localStorage.removeItem(`immich-book-description-positions-${album.id}`);
  }, [album.id]);

  // Save config to localStorage whenever it changes (with clamped values)

  /* ------------------------------------------------------------------ */
  /* Rückgängig (letzte Schritte)                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Der Verlauf arbeitet auf Momentaufnahmen genau des Zustands, der ohnehin
   * gespeichert wird. Dadurch deckt ein Rückgängig ALLE Bearbeitungen ab
   * (Reihenfolge, Zuschnitte, Drehungen, Beschriftungen, Leerräume, freie
   * Elemente, Seiteneinstellungen …), ohne dass jede einzelne Aktion eigens
   * Buch führen muss — und kann nicht vergessen werden, wenn später neue
   * Funktionen dazukommen.
   */
  const UNDO_LIMIT = 5;
  const undoStackRef = useRef<string[]>([]);
  const lastSnapshotRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const [undoDepth, setUndoDepth] = useState(0);

  /** Momentaufnahme wieder einspielen. */
  const applySnapshot = (snap: string) => {
    let c: (AlbumConfig & {
      overlayElements?: Record<string, PageElement[]>;
      titlePage?: TitlePageConfig | null;
      extraPages?: ExtraPage[];
    }) | null = null;
    try {
      c = JSON.parse(snap);
    } catch {
      return;
    }
    if (!c) return;

    restoringRef.current = true;
    _setPageSize(c.pageSize);
    _setOrientation(c.orientation);
    setPageWidth(c.pageWidth);
    setPageHeight(c.pageHeight);
    setMargin(c.margin);
    setCombinePages(c.combinePages);
    setRowHeight(c.rowHeight);
    setSpacing(c.spacing);
    setFilterVideos(c.filterVideos);
    setShowDates(c.showDates);
    setShowDescriptions(c.showDescriptions);
    setFontSize(c.fontSize);
    setPageBackground(c.pageBackground);
    setLayoutMode(c.layoutMode);
    setCustomAspectRatios(new Map(Object.entries(c.customAspectRatios ?? {})));
    setHeightFactors(new Map(Object.entries(c.heightFactors ?? {})));
    setImageAlignments(new Map(Object.entries(c.imageAlignments ?? {})));
    setDateVisibility(new Map(Object.entries(c.dateVisibility ?? {})));
    setRotations(new Map(Object.entries(c.rotations ?? {})));
    setPageBreakBefore(new Set(c.pageBreakBefore ?? []));
    setCustomOrdering(c.customOrdering ?? null);
    setDescriptionPositions(new Map(Object.entries(c.descriptionPositions ?? {})));
    setPageAlignments(
      new Map(
        Object.entries(c.pageAlignments ?? {}).map(([k, v]) => [Number(k), v]),
      ),
    );
    setPageLayoutModes(
      new Map(
        Object.entries(c.pageLayoutModes ?? {}).map(([k, v]) => [Number(k), v]),
      ),
    );
    setExcludedAssetIds(new Set(c.excludedAssetIds ?? []));
    setCropPositions(new Map(Object.entries(c.cropPositions ?? {})));
    setBlockerTexts(new Map(Object.entries(c.blockerTexts ?? {})));
    setImageCaptionTexts(new Map(Object.entries(c.imageCaptionTexts ?? {})));
    setBlockerDrawings(new Map(Object.entries(c.blockerDrawings ?? {})));
    setBlockerMaps(new Map(Object.entries(c.blockerMaps ?? {})));
    setOverlayElements(c.overlayElements ?? {});
    setTitlePage(c.titlePage ?? null);
    setExtraPages(c.extraPages ?? []);
    setSelectedElementId(null);
  };

  const handleUndo = () => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setUndoDepth(undoStackRef.current.length);
    // Der Speicher-Effekt darf diesen Sprung nicht als neue Änderung werten,
    // sonst käme man nie zurück.
    lastSnapshotRef.current = prev;
    applySnapshot(prev);
  };

  // Strg+Z – außer während einer Texteingabe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    // Only save if all values are valid
    if (
      !isPageWidthValid ||
      !isPageHeightValid ||
      !isMarginValid ||
      !isRowHeightValid ||
      !isSpacingValid
    ) {
      return;
    }

    const config: AlbumConfig = {
      pageSize,
      orientation,
      pageWidth,
      pageHeight,
      margin,
      combinePages,
      rowHeight,
      spacing,
      filterVideos,
      showDates,
      showDescriptions,
      fontSize,
      pageBackground,
      layoutMode,
      customAspectRatios: Object.fromEntries(customAspectRatios),
      heightFactors: Object.fromEntries(heightFactors),
      imageAlignments: Object.fromEntries(imageAlignments),
      dateVisibility: Object.fromEntries(dateVisibility),
      rotations: Object.fromEntries(rotations),
      pageBreakBefore: Array.from(pageBreakBefore),
      customOrdering,
      descriptionPositions: Object.fromEntries(descriptionPositions),
      pageAlignments: Object.fromEntries(pageAlignments),
      pageLayoutModes: Object.fromEntries(pageLayoutModes),
      excludedAssetIds: Array.from(excludedAssetIds),
      cropPositions: Object.fromEntries(cropPositions),
      blockerTexts: Object.fromEntries(blockerTexts),
      imageCaptionTexts: Object.fromEntries(imageCaptionTexts),
      blockerDrawings: Object.fromEntries(blockerDrawings),
      blockerMaps: Object.fromEntries(blockerMaps),
    };
    const full = {
      ...config,
      overlayElements,
      titlePage,
      extraPages,
    };

    // Verlauf pflegen: Bei jeder echten Änderung wandert der VORHERIGE Stand auf
    // den Stapel (höchstens UNDO_LIMIT Einträge). Ein Rückgängig selbst legt
    // nichts nach – sonst käme man nicht weiter zurück.
    const snapshot = JSON.stringify(full);
    if (lastSnapshotRef.current === null) {
      lastSnapshotRef.current = snapshot;
    } else if (snapshot !== lastSnapshotRef.current) {
      if (restoringRef.current) {
        restoringRef.current = false;
      } else {
        undoStackRef.current.push(lastSnapshotRef.current);
        if (undoStackRef.current.length > UNDO_LIMIT) {
          undoStackRef.current.shift();
        }
        setUndoDepth(undoStackRef.current.length);
      }
      lastSnapshotRef.current = snapshot;
    }

    saveAlbumConfig(album.id, full);

  }, [
    album.id,
    pageSize,
    orientation,
    pageWidth,
    pageHeight,
    margin,
    combinePages,
    rowHeight,
    spacing,
    filterVideos,
    showDates,
    showDescriptions,
    fontSize,
    pageBackground,
    layoutMode,
    customAspectRatios,
    heightFactors,
    imageAlignments,
    dateVisibility,
    rotations,
    pageBreakBefore,
    customOrdering,
    descriptionPositions,
    pageAlignments,
    pageLayoutModes,
    overlayElements,
    excludedAssetIds,
    cropPositions,
    blockerTexts,
    imageCaptionTexts,
    blockerDrawings,
    blockerMaps,
    titlePage,
    extraPages,
    isPageWidthValid,
    isPageHeightValid,
    isMarginValid,
    isRowHeightValid,
    isSpacingValid,
  ]);

  // Bild-URL eines (echten) Fotos: bei lokalen Alben aus dem Store-Volume,
  // sonst als Immich-Thumbnail same-origin über den /api-Proxy.
  const isLocal = isLocalAlbumId(album.id);
  const assetImageUrl = (assetId: string): string =>
    isLocal
      ? localMediaUrl(album.id, assetId)
      : `${immichConfig.baseUrl}/assets/${assetId}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`;

  const loadAlbumAssets = async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (isLocal) {
        // Lokales Album: Fotos kommen aus dem Manifest (bereits im synthetischen
        // AlbumResponseDto), Reihenfolge = Upload-Reihenfolge.
        setAssets(album.assets ?? []);
        return;
      }
      const albumData = await getAlbumInfo({ id: album.id });
      // Sort assets by creation date ascending
      const sorted = albumData.assets.sort((a, b) => {
        return (
          new Date(a.fileCreatedAt).getTime() -
          new Date(b.fileCreatedAt).getTime()
        );
      });
      setAssets(sorted);
    } catch (err) {
      setError(
        (err as Error).message || "Album-Fotos konnten nicht geladen werden",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Lokales Album: weitere Fotos im Editor hochladen (Store + Manifest + Grid).
  const [isUploadingLocal, setIsUploadingLocal] = useState(false);
  const [localUploadProgress, setLocalUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const handleAddLocalPhotos = async (files: FileList | File[]) => {
    if (!isLocal) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setIsUploadingLocal(true);
    setLocalUploadProgress({ done: 0, total: list.length });
    try {
      const current = await loadLocalAlbum(album.id);
      if (!current) return;
      const updated = await addPhotosToLocalAlbum(current, list, (done, total) =>
        setLocalUploadProgress({ done, total }),
      );
      setAssets(localAlbumAssets(updated));
    } catch (e) {
      console.error("Upload lokaler Fotos fehlgeschlagen:", e);
    } finally {
      setIsUploadingLocal(false);
      setLocalUploadProgress(null);
    }
  };

  // Lokales Album: Fotos aus Immich übernehmen. Die Bilder werden in den Store
  // kopiert, sind danach also unabhängig von Immich.
  // Zwei Quellen: Fotos, die in KEINEM Immich-Album liegen (Standard – genau
  // die findet man dort sonst schwer wieder), oder gezielt aus einem Album.
  // Nur möglich, wenn eine Immich-Verbindung besteht (im Ohne-Immich-Modus ist
  // der Schlüssel leer).
  const immichAvailable = immichConfig.apiKey.trim().length > 0;
  const IMMICH_PAGE_SIZE = 120;
  const [showImmichImport, setShowImmichImport] = useState(false);
  const [immichMode, setImmichMode] = useState<"unassigned" | "album">(
    "unassigned",
  );
  const [immichAlbums, setImmichAlbums] = useState<AlbumResponseDto[] | null>(
    null,
  );
  const [immichSource, setImmichSource] = useState<AlbumResponseDto | null>(
    null,
  );
  // Fotos ohne Album (seitenweise nachgeladen).
  const [immichLoose, setImmichLoose] = useState<AssetResponseDto[]>([]);
  const [immichLoosePage, setImmichLoosePage] = useState(1);
  const [immichLooseMore, setImmichLooseMore] = useState(false);
  const [immichPicked, setImmichPicked] = useState<Set<string>>(new Set());
  const [immichBusy, setImmichBusy] = useState(false);
  const [immichError, setImmichError] = useState<string | null>(null);

  /** Fotos laden, die in keinem Immich-Album liegen. `append` hängt die nächste Seite an. */
  const loadLooseAssets = async (append = false) => {
    try {
      setImmichBusy(true);
      setImmichError(null);
      const page = append ? immichLoosePage + 1 : 1;
      const res = await searchAssets({
        metadataSearchDto: {
          isNotInAlbum: true,
          type: AssetTypeEnum.Image,
          withExif: true,
          page,
          size: IMMICH_PAGE_SIZE,
        },
      });
      const items = res.assets.items ?? [];
      setImmichLoose((prev) => (append ? [...prev, ...items] : items));
      setImmichLoosePage(page);
      setImmichLooseMore(!!res.assets.nextPage);
    } catch (e) {
      console.error("Fotos ohne Album konnten nicht geladen werden:", e);
      setImmichError("Fotos ohne Album konnten nicht geladen werden.");
    } finally {
      setImmichBusy(false);
    }
  };

  const openImmichImport = async () => {
    setShowImmichImport(true);
    setImmichMode("unassigned");
    setImmichSource(null);
    setImmichPicked(new Set());
    setImmichError(null);
    if (immichLoose.length === 0) await loadLooseAssets(false);
  };

  /** Auf die Album-Auswahl wechseln (Albenliste einmalig laden). */
  const openImmichAlbumMode = async () => {
    setImmichMode("album");
    setImmichSource(null);
    setImmichPicked(new Set());
    setImmichError(null);
    if (immichAlbums) return;
    try {
      setImmichBusy(true);
      const [owned, shared] = await Promise.all([
        getAllAlbums({}),
        getAllAlbums({ shared: true }),
      ]);
      const unique = Array.from(
        new Map([...owned, ...shared].map((a) => [a.id, a])).values(),
      ).sort((a, b) => a.albumName.localeCompare(b.albumName));
      setImmichAlbums(unique);
    } catch (e) {
      console.error("Immich-Alben konnten nicht geladen werden:", e);
      setImmichError("Immich-Alben konnten nicht geladen werden.");
    } finally {
      setImmichBusy(false);
    }
  };

  const openImmichSource = async (albumId: string) => {
    try {
      setImmichBusy(true);
      setImmichError(null);
      const info = await getAlbumInfo({ id: albumId });
      setImmichSource(info);
      setImmichPicked(new Set());
    } catch (e) {
      console.error("Immich-Album konnte nicht geladen werden:", e);
      setImmichError("Album konnte nicht geladen werden.");
    } finally {
      setImmichBusy(false);
    }
  };

  /** Die aktuell zur Auswahl stehenden Fotos (je nach Quelle). */
  const immichPickable: AssetResponseDto[] =
    immichMode === "unassigned"
      ? immichLoose
      : (immichSource?.assets ?? []).filter((a) => a.type === "IMAGE");

  const handleImportFromImmich = async () => {
    if (!isLocal || immichPicked.size === 0) return;
    const picked = immichPickable.filter((a) => immichPicked.has(a.id));
    setIsUploadingLocal(true);
    setLocalUploadProgress({ done: 0, total: picked.length });
    try {
      const current = await loadLocalAlbum(album.id);
      if (!current) return;
      const { album: updated, added, failed } = await addImmichAssetsToLocalAlbum(
        current,
        picked.map((a) => ({
          id: a.id,
          fileName: a.originalFileName,
          createdAt: a.fileCreatedAt,
        })),
        // Bild same-origin über den /api-Proxy laden (wie in der Vorschau).
        (assetId) =>
          `${immichConfig.baseUrl}/assets/${assetId}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`,
        (done, total) => setLocalUploadProgress({ done, total }),
      );
      setAssets(localAlbumAssets(updated));
      if (added > 0) {
        // Übernommene Fotos aus der Auswahlliste entfernen: Sie liegen jetzt im
        // lokalen Album, die Immich-Liste "ohne Album" bleibt so aktuell.
        const importedIds = new Set(picked.map((a) => a.id));
        setImmichLoose((prev) => prev.filter((a) => !importedIds.has(a.id)));
        setShowImmichImport(false);
        setImmichPicked(new Set());
      }
      if (failed > 0) {
        setImmichError(
          `${failed} von ${picked.length} Fotos konnten nicht übernommen werden.`,
        );
      }
    } catch (e) {
      console.error("Immich-Import fehlgeschlagen:", e);
      setImmichError("Import fehlgeschlagen.");
    } finally {
      setIsUploadingLocal(false);
      setLocalUploadProgress(null);
    }
  };

  // Handle aspect ratio drag start
  const handleAspectDragStart = (
    assetId: string,
    edge: "left" | "right" | "top" | "bottom",
    aspectRatio: number,
    x: number,
    width: number,
    height: number,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setAspectDragState({
      assetId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      originalAspectRatio: aspectRatio,
      originalX: x,
      originalWidth: width,
      originalHeight: height,
    });
  };

  // Natürliches/eingestelltes Seitenverhältnis eines Assets.
  const assetAspectRatio = (asset: AssetResponseDto): number => {
    const custom = customAspectRatios.get(asset.id);
    if (custom) return custom;
    const w = asset.exifInfo?.exifImageWidth || 1;
    const h = asset.exifInfo?.exifImageHeight || 1;
    if (asset.exifInfo?.orientation === "6") return h / w;
    return w / h;
  };

  // Ausrichtung eines Fotos in seiner Zeile durchschalten:
  // Seiten-Standard -> links -> mittig -> rechts -> Seiten-Standard.
  const cycleImageAlignment = (assetId: string) => {
    setImageAlignments((prev) => {
      const next = new Map(prev);
      const cur = next.get(assetId);
      if (!cur) next.set(assetId, "left");
      else if (cur === "left") next.set(assetId, "center");
      else if (cur === "center") next.set(assetId, "right");
      else next.delete(assetId);
      return next;
    });
  };

  // Datumsanzeige eines einzelnen Fotos: eigener Eintrag gewinnt, sonst gilt
  // die globale Einstellung (Zahnrad -> "Datum anzeigen").
  const isDateVisible = (assetId: string): boolean =>
    dateVisibility.get(assetId) ?? showDates;

  /** Formatiertes Aufnahmedatum – oder undefined, wenn es nicht gezeigt wird. */
  const photoDateText = (asset: AssetResponseDto): string | undefined =>
    isDateVisible(asset.id) && asset.fileCreatedAt
      ? new Date(asset.fileCreatedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : undefined;

  // Aufnahmedatum für EIN Foto ein-/ausblenden. Entspricht der Zustand danach
  // wieder der globalen Einstellung, wird der Override entfernt (kein Ballast).
  const togglePhotoDate = (assetId: string) => {
    setDateVisibility((prev) => {
      const next = new Map(prev);
      const wanted = !isDateVisible(assetId);
      if (wanted === showDates) next.delete(assetId);
      else next.set(assetId, wanted);
      return next;
    });
  };

  // Foto in 90°-Schritten drehen. Das Seitenverhältnis dreht sich mit, das
  // Layout bricht die Zeile also passend neu um (siehe pages-useMemo).
  const rotatePhoto = (assetId: string) => {
    setRotations((prev) => {
      const next = new Map(prev);
      const deg = ((next.get(assetId) ?? 0) + 90) % 360;
      if (deg === 0) next.delete(assetId);
      else next.set(assetId, deg);
      return next;
    });
  };

  // Collage: eine Kachel zwischen "normal" (1) und "hoch" (2) umschalten.
  const toggleHeightFactor = (assetId: string) => {
    setHeightFactors((prev) => {
      const next = new Map(prev);
      if ((next.get(assetId) ?? 1) >= 2) next.delete(assetId);
      else next.set(assetId, 2);
      return next;
    });
  };

  // Auto-Collage für eine Seite: Hochformate zu hohen Kacheln machen (mit
  // Abstand, damit daneben Kacheln gestapelt werden) -> Masonry-Verteilung.
  const handleAutoCollagePage = (photos: { asset: AssetResponseDto }[]) => {
    setHeightFactors((prev) => {
      const next = new Map(prev);
      let prevTall = false;
      for (const pb of photos) {
        const id = pb.asset.id;
        if (isBlocker(id)) {
          prevTall = false;
          continue;
        }
        if (assetAspectRatio(pb.asset) < 0.9 && !prevTall) {
          next.set(id, 2);
          prevTall = true;
        } else {
          next.delete(id);
          prevTall = false;
        }
      }
      return next;
    });
  };

  // Raster-Modus: Fotos einer Seite automatisch anordnen -> manuelle
  // Seitenverhältnisse (Größen) der Fotos dieser Seite zurücksetzen, sodass das
  // justierte Layout sie gleichmäßig skaliert und verteilt.
  const handleAutoArrangePage = (photos: { asset: AssetResponseDto }[]) => {
    const ids = photos.map((p) => p.asset.id).filter((id) => !isBlocker(id));
    if (ids.length === 0) return;
    setCustomAspectRatios((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  // Per-Seite-Modus: logische Seiten einer Doppelseite (bzw. die Einzelseite).
  const spreadLogicalPages = (pageNumber: number): number[] =>
    combinePages ? [pageNumber * 2 - 1, pageNumber * 2] : [pageNumber];
  const spreadEffectiveMode = (
    pageNumber: number,
  ): "justified" | "collage" =>
    pageLayoutModes.get(spreadLogicalPages(pageNumber)[0]) ?? layoutMode;
  const toggleSpreadMode = (pageNumber: number) => {
    const ns = spreadLogicalPages(pageNumber);
    const target =
      spreadEffectiveMode(pageNumber) === "collage" ? "justified" : "collage";
    setPageLayoutModes((prev) => {
      const next = new Map(prev);
      for (const n of ns) {
        // Entspricht der Ziel-Modus dem Standard -> Override entfernen.
        if (target === layoutMode) next.delete(n);
        else next.set(n, target);
      }
      return next;
    });
  };

  // Handle crop (object-position) drag start
  const handleCropDragStart = (
    assetId: string,
    boxWidth: number,
    boxHeight: number,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const current = cropPositions.get(assetId) ?? { x: 50, y: 50 };
    setCropDragState({
      assetId,
      startX: event.clientX,
      startY: event.clientY,
      originalX: current.x,
      originalY: current.y,
      boxWidth,
      boxHeight,
    });
  };

  const handleResetCrop = (assetId: string) => {
    setCropPositions((prev) => {
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  };

  // Zoom (Ausschnittsvergrößerung) für ein Foto setzen. scale <= 1 ohne
  // Verschiebung -> Eintrag entfernen (kein Crop).
  const handleCropZoom = (assetId: string, scale: number) => {
    setCropPositions((prev) => {
      const next = new Map(prev);
      const cur = prev.get(assetId) ?? { x: 50, y: 50 };
      if (scale <= 1 && cur.x === 50 && cur.y === 50) {
        next.delete(assetId);
      } else {
        next.set(assetId, {
          x: cur.x,
          y: cur.y,
          ...(scale > 1 ? { scale } : {}),
        });
      }
      return next;
    });
  };

  // Generischer Text-Setter für eine StyledText-Map; leerer Text -> Eintrag weg
  // (behält aber vorhandenen Stil, solange Text vorhanden ist).
  const setStyledMapText = (
    setter: React.Dispatch<React.SetStateAction<Map<string, StyledText>>>,
    key: string,
    text: string,
  ) => {
    setter((prev) => {
      const next = new Map(prev);
      if (text.trim().length === 0) {
        next.delete(key);
      } else {
        next.set(key, { ...(prev.get(key) ?? { text: "" }), text });
      }
      return next;
    });
  };
  // Stil-Patch (Größe/Farbe/Schriftart/Hintergrund) auf einen Eintrag anwenden.
  const patchStyledMap = (
    setter: React.Dispatch<React.SetStateAction<Map<string, StyledText>>>,
    key: string,
    patch: Partial<StyledText>,
  ) => {
    setter((prev) => {
      const next = new Map(prev);
      next.set(key, { ...(prev.get(key) ?? { text: "" }), ...patch });
      return next;
    });
  };
  const setBlockerText = (id: string, text: string) =>
    setStyledMapText(setBlockerTexts, id, text);
  const setImageCaptionText = (assetId: string, text: string) =>
    setStyledMapText(setImageCaptionTexts, assetId, text);

  // Stil-Patch auf das gerade bearbeitete Element (Leerraum ODER Bildunterschrift).
  const patchActiveStyle = (patch: Partial<StyledText>) => {
    if (editingBlockerId)
      patchStyledMap(setBlockerTexts, editingBlockerId, patch);
    else if (editingCaptionAssetId)
      patchStyledMap(setImageCaptionTexts, editingCaptionAssetId, patch);
  };

  // Beim Verlassen des Edit-Modus leere Einträge (nur Button, kein Text) entfernen.
  // Ausnahme beim Leerraum: ein gesetzter Hintergrund (z. B. "transparent")
  // bleibt erhalten, auch wenn kein Text drinsteht.
  const finishTextEditing = () => {
    if (editingBlockerId) {
      const entry = blockerTexts.get(editingBlockerId);
      const t = entry?.text ?? "";
      if (t.trim().length === 0 && !entry?.backgroundColor)
        setBlockerTexts((prev) => {
          const n = new Map(prev);
          n.delete(editingBlockerId);
          return n;
        });
      setEditingBlockerId(null);
    }
    if (editingCaptionAssetId) {
      const t = imageCaptionTexts.get(editingCaptionAssetId)?.text ?? "";
      if (t.trim().length === 0)
        setImageCaptionTexts((prev) => {
          const n = new Map(prev);
          n.delete(editingCaptionAssetId);
          return n;
        });
      setEditingCaptionAssetId(null);
    }
  };

  /* --- Zeichenzonen (Pointer: Maus/Touch/Stift) --- */
  // Normalisierte Position (0..1) eines Pointer-Events innerhalb eines Elements.
  const pointerNorm = (
    e: React.PointerEvent,
    el: HTMLElement,
  ): [number, number] => {
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1)));
    return [x, y];
  };
  const handleDrawPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* kein aktiver Pointer (z. B. synthetisch) – ignorieren */
    }
    const [x, y] = pointerNorm(e, e.currentTarget as HTMLElement);
    setLiveStroke([x, y]);
  };
  const handleDrawPointerMove = (e: React.PointerEvent) => {
    if (!liveStroke) return;
    e.preventDefault();
    const [x, y] = pointerNorm(e, e.currentTarget as HTMLElement);
    setLiveStroke((prev) => (prev ? [...prev, x, y] : prev));
  };
  const handleDrawPointerUp = (id: string) => {
    setLiveStroke((prev) => {
      if (prev && prev.length >= 2) {
        const stroke: DrawStroke = {
          pts: prev,
          color: penColor,
          width: penWidth,
        };
        setBlockerDrawings((dm) => {
          const next = new Map(dm);
          next.set(id, [...(dm.get(id) ?? []), stroke]);
          return next;
        });
      }
      return null;
    });
  };
  const undoStroke = (id: string) =>
    setBlockerDrawings((dm) => {
      const cur = dm.get(id);
      if (!cur || cur.length === 0) return dm;
      const next = new Map(dm);
      const rest = cur.slice(0, -1);
      if (rest.length === 0) next.delete(id);
      else next.set(id, rest);
      return next;
    });
  const clearStrokes = (id: string) =>
    setBlockerDrawings((dm) => {
      if (!dm.has(id)) return dm;
      const next = new Map(dm);
      next.delete(id);
      return next;
    });

  // Reset all aspect ratio customizations
  const handleResetAllCustomizations = () => {
    setCustomAspectRatios(new Map());
  };

  // Drag & drop handlers for reordering
  const handleReorderDragStart = (
    assetId: string,
    index: number,
    event: React.DragEvent,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    setReorderDragState({ draggedAssetId: assetId, draggedIndex: index });
  };

  // Liegt der Cursor in der rechten Hälfte der Zielkachel? Dann wird rechts
  // dahinter eingefügt, sonst links davor – so verhält sich Drag & Drop wie erwartet.
  const isDropAfter = (event: React.DragEvent): boolean => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left > rect.width / 2;
  };

  const handleReorderDragOver = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
    setDropAfter(isDropAfter(event));
  };

  const handleReorderDragEnd = () => {
    setReorderDragState(null);
    setDropTargetIndex(null);
    setDropAfter(false);
  };

  const handleReorderDrop = (targetIndex: number, event: React.DragEvent) => {
    event.preventDefault();

    if (!reorderDragState) return;

    const { draggedIndex } = reorderDragState;

    // Zielposition VOR dem Entfernen bestimmen: linke Hälfte -> vor die Zielkachel,
    // rechte Hälfte -> dahinter.
    let insertPos = isDropAfter(event) ? targetIndex + 1 : targetIndex;
    // Beim Herausnehmen der gezogenen Kachel rutscht alles danach um 1 nach vorn.
    if (draggedIndex < insertPos) insertPos -= 1;

    // Kein Positionswechsel -> nichts tun (auch beim Ablegen auf sich selbst).
    if (insertPos === draggedIndex) {
      handleReorderDragEnd();
      return;
    }

    // Create new ordering based on current filtered assets
    const currentOrder = filteredAssets.map((asset) => asset.id);
    const newOrder = [...currentOrder];

    // Remove from old position
    const [removed] = newOrder.splice(draggedIndex, 1);
    // Insert at new position
    newOrder.splice(insertPos, 0, removed);

    setCustomOrdering(newOrder);
    handleReorderDragEnd();
  };

  // Reset ordering to default
  const handleResetOrdering = () => {
    setCustomOrdering(null);
  };

  // Automatische Seitengestaltung: analysiert die Fotos und setzt Reihenfolge,
  // Hervorhebungen, Szenen-Umbrüche und den Modus je Seite in EINEM Schritt.
  //
  // Die Seitenmodi hängen davon ab, welche Fotos nach der Neuordnung auf welcher
  // Seite landen. Deshalb wird das Layout hier einmal vorab durchgerechnet,
  // statt auf den nächsten Render zu warten – so wird alles in einem Rutsch
  // gesetzt und der Nutzer sieht kein Zwischenergebnis.
  const handleAutoDesign = () => {
    const photos = defaultFilteredAssets;
    if (photos.length < 2) return;

    // Wie viele Fotos passen bei den aktuellen Einstellungen auf eine Seite?
    // Daraus leitet sich ab, ab welcher Groesse eine Szene eine eigene Seite
    // verdient – sonst wuerde die Gestaltung bei kleiner Zeilenhoehe das Buch
    // in viele fast leere Seiten zerlegen.
    const baseOpts = {
      pageSize: "CUSTOM" as const,
      orientation: "portrait" as const,
      margin: validMargin,
      rowHeight: validRowHeight,
      spacing: validSpacing,
      customWidth: validPageWidth,
      customHeight: validPageHeight,
      combinePages: false,
      customAspectRatios: new Map(customAspectRatios),
    };
    const probe = calculatePageLayout(photos, baseOpts);
    const perPage = probe.length
      ? photos.length / probe.length
      : 6;
    const plan = planDesign(photos, {
      minPhotosForOwnPage: Math.max(3, Math.round(perPage * 0.6)),
    });
    const signals = collectSignals(photos);

    // Leerräume/Karten sind keine Fotos und werden nicht umsortiert – sie
    // behalten ihre ungefähre Position in der Reihenfolge.
    const blockerSlots: { index: number; id: string }[] = [];
    (customOrdering ?? []).forEach((id, i) => {
      if (isBlocker(id)) blockerSlots.push({ index: i, id });
    });
    const ordering = [...plan.ordering];
    for (const slot of blockerSlots) {
      ordering.splice(Math.min(slot.index, ordering.length), 0, slot.id);
    }

    // Layout mit dem neuen Plan vorab rechnen, um die Seitenmodi zu bestimmen.
    const byId = new Map(photos.map((a) => [a.id, a]));
    const planned = plan.ordering
      .map((id) => byId.get(id))
      .filter((a): a is AssetResponseDto => !!a);
    const previewPages = calculatePageLayout(planned, {
      ...baseOpts,
      pageBreakBefore: new Set(plan.pageBreakBefore),
    });
    const modes = choosePageModes(previewPages, signals);

    // Im Doppelseiten-Modus teilen sich beide Hälften einer Doppelseite EINEN
    // Modus (so liest ihn der Seitenschalter). Die Analyse arbeitet dagegen auf
    // logischen Einzelseiten – daher hier zusammenfassen: qualifiziert sich eine
    // Hälfte für Collage, gilt das für die ganze Doppelseite.
    const effectiveModes = new Map<number, "justified" | "collage">();
    if (combinePages) {
      const spreads = new Set<number>();
      for (const key of Object.keys(modes)) {
        spreads.add(Math.ceil(Number(key) / 2));
      }
      for (const s of spreads) {
        effectiveModes.set(s * 2 - 1, "collage");
        effectiveModes.set(s * 2, "collage");
      }
    } else {
      for (const [k, v] of Object.entries(modes)) {
        effectiveModes.set(Number(k), v);
      }
    }

    // Vorherigen Stand sichern, damit ein Klick alles zurücknimmt.
    setDesignUndo({
      ordering: customOrdering,
      heightFactors: new Map(heightFactors),
      pageLayoutModes: new Map(pageLayoutModes),
      pageBreakBefore: new Set(pageBreakBefore),
    });

    setCustomOrdering(ordering);
    setHeightFactors(new Map(Object.entries(plan.heightFactors)));
    setPageBreakBefore(new Set(plan.pageBreakBefore));
    setPageLayoutModes(new Map(effectiveModes));

    const collagePages = combinePages
      ? effectiveModes.size / 2
      : effectiveModes.size;
    const quelle =
      plan.stats.withImmichSignals > 0
        ? `${plan.stats.withImmichSignals} Fotos mit Immich-Merkmalen (Gesichter, Favoriten, Bewertung)`
        : "ohne Immich-Merkmale – nach Maßen und Aufnahmezeit";
    setDesignNote(
      `${plan.stats.scenes} ${plan.stats.scenes === 1 ? "Szene" : "Szenen"} erkannt · ` +
        `${plan.stats.highlighted} hervorgehoben · ${collagePages} Collage-Seiten · ${quelle}`,
    );
  };

  /** Nimmt die letzte automatische Gestaltung vollständig zurück. */
  const handleUndoAutoDesign = () => {
    if (!designUndo) return;
    setCustomOrdering(designUndo.ordering);
    setHeightFactors(new Map(designUndo.heightFactors));
    setPageLayoutModes(new Map(designUndo.pageLayoutModes));
    setPageBreakBefore(new Set(designUndo.pageBreakBefore));
    setDesignUndo(null);
    setDesignNote(null);
  };

  // Reset all description position customizations
  const handleResetDescriptionPositions = () => {
    setDescriptionPositions(new Map());
  };

  // Cycle description position
  const handleDescriptionClick = (assetId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Find the asset to check if it has a description
    const asset = filteredAssets.find((a) => a.id === assetId);
    const hasDescription = !!asset?.exifInfo?.description;

    // Build the cycle based on whether there's a description
    const positions: Position[] = hasDescription
      ? ["bottom", "top", "left", "right"]
      : ["bottom", "top"];

    const currentPosition = descriptionPositions.get(assetId) || "bottom";
    const currentIndex = positions.indexOf(currentPosition);
    const nextPosition = positions[(currentIndex + 1) % positions.length];

    setDescriptionPositions((prev) => {
      const next = new Map(prev);
      if (nextPosition === "bottom") {
        // Reset to default
        next.delete(assetId);
      } else {
        next.set(assetId, nextPosition);
      }
      return next;
    });
  };

  // Filter assets based on user preferences (default order)
  const defaultFilteredAssets = useMemo(() => {
    const base = filterVideos
      ? assets.filter((asset) => asset.type === "IMAGE")
      : assets;
    return base.filter((asset) => !excludedAssetIds.has(asset.id));
  }, [assets, filterVideos, excludedAssetIds]);

  // Apply custom ordering to filtered assets
  const filteredAssets = useMemo(() => {
    if (!customOrdering) return defaultFilteredAssets;

    // Create a map for quick lookup
    const assetMap = new Map(
      defaultFilteredAssets.map((asset) => [asset.id, asset]),
    );
    // Reorder based on customOrdering, filtering out any IDs that don't exist
    const reordered = customOrdering
      .map((id) =>
        assetMap.get(id) ?? (isBlocker(id) ? blockerAsset(id) : undefined),
      )
      .filter((asset): asset is AssetResponseDto => asset !== undefined);

    // Add any assets that aren't in customOrdering at the end
    const orderedIds = new Set(customOrdering);
    const remaining = defaultFilteredAssets.filter(
      (asset) => !orderedIds.has(asset.id),
    );

    return [...reordered, ...remaining];
  }, [defaultFilteredAssets, customOrdering]);

  // Insert / remove a "Leerraum" blocker (a layout placeholder; its position lives in
  // customOrdering, its size in customAspectRatios — both already persisted).
  // afterAssetId: direkt hinter dieser Asset-/Blocker-ID einsortieren; ohne Angabe
  // (oder falls die ID nicht mehr existiert) wie bisher ans Ende anhängen.
  const handleAddBlocker = (afterAssetId?: string) => {
    const id = randomId(BLOCKER_PREFIX);
    setCustomAspectRatios((prev) => new Map(prev).set(id, 1));
    setCustomOrdering((prev) => {
      const base = prev ?? defaultFilteredAssets.map((a) => a.id);
      const anchorIndex = afterAssetId ? base.indexOf(afterAssetId) : -1;
      if (anchorIndex === -1) return [...base, id];
      return [
        ...base.slice(0, anchorIndex + 1),
        id,
        ...base.slice(anchorIndex + 1),
      ];
    });
  };
  const handleDeleteBlocker = (id: string) => {
    setCustomOrdering((prev) => (prev ? prev.filter((x) => x !== id) : prev));
    setCustomAspectRatios((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setBlockerTexts((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setBlockerDrawings((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setBlockerMaps((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    if (editingBlockerId === id) setEditingBlockerId(null);
    if (drawingBlockerId === id) setDrawingBlockerId(null);
  };

  // Karten-Leerraum einfügen: ein Blocker, der zusätzlich als Karte markiert ist
  // (fließt/skaliert/löscht wie ein normaler Leerraum).
  const handleAddMap = (afterAssetId?: string) => {
    const id = randomId(BLOCKER_PREFIX);
    setCustomAspectRatios((prev) => new Map(prev).set(id, 1));
    setCustomOrdering((prev) => {
      const base = prev ?? defaultFilteredAssets.map((a) => a.id);
      const anchorIndex = afterAssetId ? base.indexOf(afterAssetId) : -1;
      if (anchorIndex === -1) return [...base, id];
      return [
        ...base.slice(0, anchorIndex + 1),
        id,
        ...base.slice(anchorIndex + 1),
      ];
    });
    setBlockerMaps((prev) => new Map(prev).set(id, {}));
  };
  // Kartenausschnitt/Schnappschuss eines Karten-Leerraums speichern.
  const setBlockerMap = (id: string, cfg: MapConfig) =>
    setBlockerMaps((prev) => new Map(prev).set(id, cfg));

  // GPS-Punkte der (echten) Fotos einer Seite für die Karte.
  const geoPointsForPhotos = (
    photos: { asset: AssetResponseDto }[],
  ): GeoPoint[] => {
    const pts: GeoPoint[] = [];
    for (const pb of photos) {
      if (isBlocker(pb.asset.id)) continue;
      const lat = pb.asset.exifInfo?.latitude;
      const lng = pb.asset.exifInfo?.longitude;
      if (typeof lat === "number" && typeof lng === "number")
        pts.push({ lat, lng });
    }
    return pts;
  };

  // Phase 4: place an album image as a free element (centered on page 1, then movable).
  // Titelblatt-Foto aus einer lokalen Datei (Klick/Drag&Drop) setzen.
  const setTitleImageFromFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const data = await fileToImageElementData(file).catch(() => null);
    if (data) setTitlePage((p) => (p ? { ...p, imageSrc: data.src } : p));
  };

  const handleInsertImage = (asset: AssetResponseDto, pageKey = "1") => {
    const naturalW = asset.exifInfo?.exifImageWidth || 1;
    const naturalH = asset.exifInfo?.exifImageHeight || 1;
    const ratio =
      asset.exifInfo?.orientation === "6"
        ? naturalH / naturalW
        : naturalW / naturalH;
    const width = 800;
    const height = Math.max(1, Math.round(width / (ratio || 1)));
    const el = createImageElement(asset.id, {
      x: Math.round((validPageWidth - width) / 2),
      y: Math.round((validPageHeight - height) / 2),
      width,
      height,
    });
    setOverlayElements((prev) => ({
      ...prev,
      [pageKey]: [...(prev[pageKey] ?? []), el],
    }));
    setSelectedElementId(el.id);
    setShowImagePicker(false);
  };

  // Externe Bilddateien (Upload oder Drag & Drop) als freie Bild-Elemente einfügen.
  const handleInsertImageFiles = async (
    files: FileList | File[],
    pageKey = "1",
  ) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const file of list) {
      let data: { src: string; width: number; height: number } | null = null;
      try {
        data = await fileToImageElementData(file);
      } catch {
        data = null;
      }
      if (!data) continue;
      const aspect = data.width / data.height || 1;
      const targetW = Math.round(validPageWidth * 0.5);
      const targetH = Math.max(1, Math.round(targetW / aspect));
      const el = createImageElement(randomId(), {
        src: data.src,
        x: Math.round((validPageWidth - targetW) / 2),
        y: Math.round((validPageHeight - targetH) / 2),
        width: targetW,
        height: targetH,
        source: "manual",
        lockAspectRatio: true,
      });
      setOverlayElements((prev) => ({
        ...prev,
        [pageKey]: [...(prev[pageKey] ?? []), el],
      }));
      setSelectedElementId(el.id);
    }
    setShowImagePicker(false);
  };

  // Phase 5: place a free text field (centered on page 1, then editable/movable).
  const handleInsertText = (pageKey = "1") => {
    const width = 1200;
    const height = 320;
    const el = createTextElement({
      x: Math.round((validPageWidth - width) / 2),
      y: Math.round((validPageHeight - height) / 2),
      width,
      height,
      fontSize: 36,
      text: "",
    });
    setOverlayElements((prev) => ({
      ...prev,
      [pageKey]: [...(prev[pageKey] ?? []), el],
    }));
    setSelectedElementId(el.id);
  };

  const handleInsertShape = (pageKey = "1") => {
    const size = 600;
    const el = createShapeElement({
      x: Math.round((validPageWidth - size) / 2),
      y: Math.round((validPageHeight - size) / 2),
      width: size,
      height: size,
    });
    setOverlayElements((prev) => ({
      ...prev,
      [pageKey]: [...(prev[pageKey] ?? []), el],
    }));
    setSelectedElementId(el.id);
  };

  const handleInsertEmoji = (emoji: string, pageKey = "1") => {
    const size = 400;
    const el = createEmojiElement(emoji, {
      x: Math.round((validPageWidth - size) / 2),
      y: Math.round((validPageHeight - size) / 2),
      width: size,
      height: size,
    });
    setOverlayElements((prev) => ({
      ...prev,
      [pageKey]: [...(prev[pageKey] ?? []), el],
    }));
    setSelectedElementId(el.id);
    setEmojiPickerOpen(false);
  };

  // Calculate content width for snapping
  const contentWidth = useMemo(() => {
    return validPageWidth - validMargin * 2;
  }, [validPageWidth, validMargin]);

  // Calculate unified page layout - single source of truth!
  const pages = useMemo(() => {
    // Phase 3: "freed" (manual) images leave the auto layout so the rest reflow
    // and close the gap; the free overlay copy floats on top.
    const layoutAssets = filteredAssets.filter(
      (a) => !manualizedAssetIds.has(a.id),
    );

    // Adjust aspect ratios for assets with left/right description positions
    const adjustedAspectRatios = new Map(customAspectRatios);

    layoutAssets.forEach((asset) => {
      const descPosition = descriptionPositions.get(asset.id) || "bottom";
      const hasDescription = showDescriptions && !!asset.exifInfo?.description;

      if (
        hasDescription &&
        (descPosition === "left" || descPosition === "right")
      ) {
        // Double the aspect ratio (make it wider) to account for description space
        const currentRatio = customAspectRatios.get(asset.id);

        if (currentRatio) {
          adjustedAspectRatios.set(asset.id, currentRatio * 2);
        } else {
          // Calculate natural aspect ratio and double it
          const width = asset.exifInfo?.exifImageWidth || 1;
          const height = asset.exifInfo?.exifImageHeight || 1;
          let naturalRatio = width / height;
          if (asset.exifInfo?.orientation === "6") {
            naturalRatio = height / width;
          }
          adjustedAspectRatios.set(asset.id, naturalRatio * 2);
        }
      }
    });

    // Um 90°/270° gedrehte Fotos: Seitenverhältnis tauschen, damit das Layout
    // die gedrehte Form einplant (Hochformat wird zu Querformat und umgekehrt).
    layoutAssets.forEach((asset) => {
      const deg = rotations.get(asset.id) ?? 0;
      if (deg !== 90 && deg !== 270) return;
      const current = adjustedAspectRatios.get(asset.id);
      let ratio = current;
      if (!ratio) {
        const width = asset.exifInfo?.exifImageWidth || 1;
        const height = asset.exifInfo?.exifImageHeight || 1;
        ratio =
          asset.exifInfo?.orientation === "6" ? height / width : width / height;
      }
      adjustedAspectRatios.set(asset.id, 1 / (ratio || 1));
    });

    const layoutOptions = {
      pageSize: "CUSTOM" as const,
      orientation: "portrait" as const,
      margin: validMargin,
      rowHeight: validRowHeight,
      spacing: validSpacing,
      customWidth: validPageWidth,
      customHeight: validPageHeight,
      combinePages,
      customAspectRatios: adjustedAspectRatios,
      pageAlignments,
      imageAlignments,
      pageBreakBefore,
    };
    // Per-Seite-Overrides vorhanden -> seitenweise Engine (jede Seite ihr Modus).
    if (pageLayoutModes.size > 0) {
      return calculateBookLayoutPerPage(layoutAssets, {
        ...layoutOptions,
        heightFactors,
        layoutMode,
        pageLayoutModes,
      });
    }
    // Collage-Modus (global): eigene Engine (justierte Bänder aus Spalten).
    if (layoutMode === "collage") {
      return calculateCollageLayout(layoutAssets, {
        ...layoutOptions,
        heightFactors,
      });
    }
    return calculatePageLayout(layoutAssets, layoutOptions);
  }, [
    filteredAssets,
    manualizedAssetIds,
    validMargin,
    validRowHeight,
    validSpacing,
    validPageWidth,
    validPageHeight,
    combinePages,
    customAspectRatios,
    descriptionPositions,
    showDescriptions,
    pageAlignments,
    imageAlignments,
    layoutMode,
    heightFactors,
    pageLayoutModes,
    rotations,
    pageBreakBefore,
  ]);

  // Den globalen "Bild hier ablegen"-Hinweis zuverlässig zurücksetzen — bei JEDEM
  // Drop/abgebrochenen Drag (Capture, auch wenn ein Kind-Handler stopPropagation nutzt).
  useEffect(() => {
    const clear = () => setIsDraggingFile(false);
    window.addEventListener("drop", clear, true);
    window.addEventListener("dragend", clear, true);
    return () => {
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("dragend", clear, true);
    };
  }, []);

  // Phase 3: resolve the DOM target for the Moveable handles (selected overlay element).
  useEffect(() => {
    if (mode !== "preview" || !selectedElementId || editingTextId) {
      setMoveableTarget(null);
      return;
    }
    setMoveableTarget(
      document.querySelector(
        `[data-overlay-id="${selectedElementId}"]`,
      ) as HTMLElement | null,
    );
  }, [selectedElementId, mode, pages, overlayElements, editingTextId]);

  // Phase 3/5: patch the GEOMETRY (base props) of any overlay element by id
  // (used by the Moveable handlers + z-index — works for image and text).
  const updateOverlayElement = (
    id: string,
    patch: (el: PageElement) => Partial<BaseElement>,
  ) => {
    setOverlayElements((prev) => {
      const next: Record<string, PageElement[]> = {};
      for (const [pageId, els] of Object.entries(prev)) {
        next[pageId] = els.map((el) =>
          el.id === id ? ({ ...el, ...patch(el) } as PageElement) : el,
        );
      }
      return next;
    });
  };

  // Phase 5: patch a TEXT element's own fields (content, font, color, align).
  const updateTextElement = (
    id: string,
    patch: (el: TextElement) => Partial<TextElement>,
  ) => {
    setOverlayElements((prev) => {
      const next: Record<string, PageElement[]> = {};
      for (const [pageId, els] of Object.entries(prev)) {
        next[pageId] = els.map((el) =>
          el.id === id && isTextElement(el) ? { ...el, ...patch(el) } : el,
        );
      }
      return next;
    });
  };

  // Phase 6: patch an IMAGE element's own fields (e.g. caption).
  const updateImageElement = (
    id: string,
    patch: (el: ImageElement) => Partial<ImageElement>,
  ) => {
    setOverlayElements((prev) => {
      const next: Record<string, PageElement[]> = {};
      for (const [pageId, els] of Object.entries(prev)) {
        next[pageId] = els.map((el) =>
          el.id === id && isImageElement(el) ? { ...el, ...patch(el) } : el,
        );
      }
      return next;
    });
  };

  // Phase 7: patch a SHAPE element's own fields (shape, fill, stroke, …).
  const updateShapeElement = (
    id: string,
    patch: (el: ShapeElement) => Partial<ShapeElement>,
  ) => {
    setOverlayElements((prev) => {
      const next: Record<string, PageElement[]> = {};
      for (const [pageId, els] of Object.entries(prev)) {
        next[pageId] = els.map((el) =>
          el.id === id && isShapeElement(el) ? { ...el, ...patch(el) } : el,
        );
      }
      return next;
    });
  };

  // Currently selected overlay element (for the type-aware toolbar).
  const selectedElement: PageElement | null = selectedElementId
    ? (Object.values(overlayElements)
        .flat()
        .find((e) => e.id === selectedElementId) ?? null)
    : null;

  // Phase 3: z-index — bring the selected overlay element to front / send to back.
  const handleBringToFront = (id: string) => {
    const zs = Object.values(overlayElements)
      .flat()
      .filter(isImageElement)
      .map((el) => el.zIndex);
    updateOverlayElement(id, () => ({
      zIndex: (zs.length ? Math.max(...zs) : 0) + 1,
    }));
  };
  const handleSendToBack = (id: string) => {
    const zs = Object.values(overlayElements)
      .flat()
      .filter(isImageElement)
      .map((el) => el.zIndex);
    updateOverlayElement(id, () => ({
      zIndex: (zs.length ? Math.min(...zs) : 0) - 1,
    }));
  };

  // Phase 3: snap targets for the selected element — its page edges + sibling elements.
  const snapElementGuidelines: HTMLElement[] = moveableTarget
    ? [
        moveableTarget.offsetParent,
        ...Array.from(
          moveableTarget.offsetParent?.querySelectorAll("[data-overlay-id]") ??
            [],
        ).filter((n) => n !== moveableTarget),
      ].filter((n): n is HTMLElement => n instanceof HTMLElement)
    : [];

  // Phase 3: re-fix a freed element (undo "Lösen") so its asset rejoins the auto layout.
  const refixElement = async (id: string) => {
    // Element über alle Seiten finden.
    let target: PageElement | undefined;
    for (const els of Object.values(overlayElements)) {
      const found = els.find((el) => el.id === id);
      if (found) {
        target = found;
        break;
      }
    }
    // Ein frei platziertes/gedropptes Bild hat eine eigene src (kein echtes
    // Grid-Asset). Es einfach zu entfernen würde es verschwinden lassen.
    if (target && isImageElement(target) && target.src) {
      if (isLocal) {
        // Ins lokale Album übernehmen -> echtes Raster-Foto.
        try {
          const current = await loadLocalAlbum(album.id);
          if (current) {
            const updated = await addDataUrlToLocalAlbum(current, target.src);
            setAssets(localAlbumAssets(updated));
          }
        } catch (e) {
          console.error("Bild konnte nicht ins Album übernommen werden:", e);
          return; // Overlay behalten, damit nichts verloren geht
        }
      } else {
        // Immich-Album: es gibt kein Raster-Ziel für ein eigenes Bild ->
        // Element als frei platziertes Bild behalten (nicht entfernen).
        return;
      }
    }
    // Gelöstes Grid-Foto (ohne eigene src) bzw. übernommenes lokales Bild:
    // Overlay entfernen, das Foto ist (wieder) Teil des Rasters.
    setOverlayElements((prev) => {
      const next: Record<string, PageElement[]> = {};
      for (const [pageId, els] of Object.entries(prev)) {
        const kept = els.filter((el) => el.id !== id);
        if (kept.length) next[pageId] = kept;
      }
      return next;
    });
    setSelectedElementId(null);
  };

  // Handle aspect ratio drag
  useEffect(() => {
    if (!aspectDragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      // Vertikale Kanten (oben/unten): Höhe ziehen -> Seitenverhältnis ändern.
      // Im justierten Layout wird ein Foto dadurch höher (schmaler) bzw. flacher.
      if (
        aspectDragState.edge === "top" ||
        aspectDragState.edge === "bottom"
      ) {
        const deltaY = event.clientY - aspectDragState.startY;
        const dPix = screenToLayoutPx(deltaY);
        const heightDelta =
          aspectDragState.edge === "bottom" ? dPix : -dPix;
        const newHeight = Math.max(
          50,
          aspectDragState.originalHeight + heightDelta,
        );
        // Breite konstant halten (analog zum horizontalen Ziehen).
        const widthFromOriginal =
          aspectDragState.originalHeight * aspectDragState.originalAspectRatio;
        const newAspectRatio = widthFromOriginal / newHeight;
        setCustomAspectRatios((prev) => {
          const next = new Map(prev);
          next.set(aspectDragState.assetId, newAspectRatio);
          return next;
        });
        return;
      }

      const deltaX = event.clientX - aspectDragState.startX;
      // Convert from 72 DPI screen to 300 DPI layout
      const deltaPixels = screenToLayoutPx(deltaX);

      // Calculate new width based on edge being dragged
      const widthDelta =
        aspectDragState.edge === "right" ? deltaPixels : -deltaPixels;
      let newWidth = Math.max(50, aspectDragState.originalWidth + widthDelta);

      // Snap to full width when within threshold
      // Determine which page the image is on and snap to that page's right edge
      const snapThreshold = 50;
      const singlePageWidth = contentWidth + validMargin;

      // Calculate which page we're on (0-indexed)
      const pageIndex = Math.floor(
        aspectDragState.originalX / (singlePageWidth + validMargin),
      );

      // Calculate this page's start X position
      const pageStartX =
        pageIndex * (singlePageWidth + validMargin) + validMargin;

      // Calculate right edge relative to this page's start
      const rightEdge = aspectDragState.originalX - pageStartX + newWidth;

      if (Math.abs(rightEdge - contentWidth) <= snapThreshold) {
        newWidth = pageStartX + contentWidth - aspectDragState.originalX;
      }

      // Calculate new aspect ratio (width stays same height, so aspect ratio changes)
      const heightFromOriginal =
        aspectDragState.originalWidth / aspectDragState.originalAspectRatio;
      const newAspectRatio = newWidth / heightFromOriginal;

      setCustomAspectRatios((prev) => {
        const next = new Map(prev);
        next.set(aspectDragState.assetId, newAspectRatio);
        return next;
      });
    };

    const handleMouseUp = () => {
      setAspectDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [aspectDragState, contentWidth, margin]);

  // Handle crop (object-position) drag: image follows the mouse, so moving the
  // cursor right must reveal more of the image's left side (object-position-x sinkt).
  useEffect(() => {
    if (!cropDragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - cropDragState.startX;
      const deltaY = event.clientY - cropDragState.startY;
      const deltaPercentX = (deltaX / cropDragState.boxWidth) * 100;
      const deltaPercentY = (deltaY / cropDragState.boxHeight) * 100;

      const newX = Math.min(
        100,
        Math.max(0, cropDragState.originalX - deltaPercentX),
      );
      const newY = Math.min(
        100,
        Math.max(0, cropDragState.originalY - deltaPercentY),
      );

      setCropPositions((prev) => {
        const next = new Map(prev);
        const scale = prev.get(cropDragState.assetId)?.scale;
        next.set(cropDragState.assetId, {
          x: newX,
          y: newY,
          ...(scale && scale > 1 ? { scale } : {}),
        });
        return next;
      });
    };

    const handleMouseUp = () => {
      setCropDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [cropDragState]);

  // Determine pageLayout based on combinePages setting
  const pageLayout = combinePages ? "singlePage" : "twoPageLeft";

  // Titelblatt-Maße. Das Titelblatt kann eine eigene Orientierung haben
  // (titlePage.orientation); fehlt sie, folgt es dem Buchformat.
  const pageIsLandscape = validPageWidth > validPageHeight;
  const titleOrientation: "portrait" | "landscape" =
    titlePage?.orientation ?? (pageIsLandscape ? "landscape" : "portrait");
  const titleShortPx = Math.min(validPageWidth, validPageHeight);
  const titleLongPx = Math.max(validPageWidth, validPageHeight);
  const titleSingleWidthPx =
    titleOrientation === "landscape" ? titleLongPx : titleShortPx;
  const titlePageHeightPx =
    titleOrientation === "landscape" ? titleShortPx : titleLongPx;
  // Das Titelblatt ist immer nur EINE Seite breit (wie ein zusammengeklapptes
  // Buch) – auch im Doppelseiten-Modus, wo die Inhaltsseiten paarweise erscheinen.
  const titlePageWidthPx = titleSingleWidthPx;
  const titleDisplayW = toPoints(titlePageWidthPx);
  const titleDisplayH = toPoints(titlePageHeightPx);
  // Leere Seiten füllen dagegen im Doppelmodus die ganze Doppelseite.
  const blankPageWidthPx = combinePages
    ? titleSingleWidthPx * 2
    : titleSingleWidthPx;
  const blankDisplayW = toPoints(blankPageWidthPx);
  const blankDisplayH = titleDisplayH;
  const titleTextColor = pageBackground === "darkbrown" ? "#f5f0e6" : "#1c1917";

  // Overlay-Ebene (freie Elemente) einer Seite — für Auto- UND Leerseiten,
  // adressiert über den jeweiligen pageKey (Seitennummer bzw. Leerseiten-ID).
  const renderOverlay = (pageKey: string) =>
    (overlayElements[pageKey] ?? []).map((el) => (
      <div
        key={el.id}
        data-overlay-id={el.id}
        className={`absolute overflow-hidden cursor-move ${
          selectedElementId === el.id
            ? "outline outline-2 outline-primary-500"
            : ""
        }`}
        style={{ ...elementBoxStyle(el), zIndex: 40 + el.zIndex }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedElementId(el.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (isTextElement(el)) {
            setSelectedElementId(el.id);
            setEditingTextId(el.id);
          }
        }}
      >
        {isImageElement(el) ? (
          <WebElement
            element={el}
            ctx={{
              imageUrl:
                el.src ??
                assetImageUrl(el.assetId),
              descPosition: "bottom",
              styles: webStyles,
            }}
          />
        ) : isTextElement(el) ? (
          editingTextId === el.id ? (
            <textarea
              autoFocus
              value={el.text}
              onChange={(ev) =>
                updateTextElement(el.id, () => ({ text: ev.target.value }))
              }
              onBlur={() => setEditingTextId(null)}
              onKeyDown={(ev) => {
                if (ev.key === "Escape")
                  (ev.target as HTMLTextAreaElement).blur();
              }}
              onClick={(ev) => ev.stopPropagation()}
              className="w-full h-full resize-none border-0 outline-none bg-transparent overflow-hidden"
              style={{
                fontFamily: el.fontFamily,
                fontSize: `${el.fontSize}px`,
                color: el.color,
                textAlign: el.align,
                fontWeight: el.fontWeight,
                fontStyle: el.italic ? "italic" : undefined,
                lineHeight: 1.25,
                padding: 4,
              }}
            />
          ) : (
            <WebTextElement element={el} />
          )
        ) : isShapeElement(el) ? (
          <WebShapeElement element={el} />
        ) : isEmojiElement(el) ? (
          <WebEmojiElement element={el} />
        ) : null}
      </div>
    ));

  // PDF-Overlay-Ebene einer Seite.
  const renderPdfOverlay = (pageKey: string) =>
    (overlayElements[pageKey] ?? []).map((el) =>
      isImageElement(el) ? (
        <PdfElement
          key={el.id}
          element={el}
          ctx={{
            imageUrl: el.src ?? assetImageUrl(el.assetId),
            descPosition: "bottom",
            styles: pdfStyles,
          }}
        />
      ) : isTextElement(el) ? (
        <PdfTextElement key={el.id} element={el} />
      ) : isShapeElement(el) ? (
        <PdfShapeElement key={el.id} element={el} />
      ) : isEmojiElement(el) ? (
        <PdfEmojiElement key={el.id} element={el} />
      ) : null,
    );

  // Leerseiten verwalten.
  // afterPage: Anker-Seitenzahl, nach der eingefügt wird; Standard = Ende des Buchs
  // (bisheriges Verhalten des globalen Toolbar-Buttons "+ Leere Seite").
  const addBlankPage = (afterPage: number = pages.length) =>
    setExtraPages((prev) => [
      ...prev,
      { id: randomId("extra-"), afterPage },
    ]);
  const deleteExtraPage = (id: string) => {
    setExtraPages((prev) => prev.filter((ep) => ep.id !== id));
    setOverlayElements((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedElementId(null);
  };
  const moveExtraPage = (id: string, dir: number) =>
    setExtraPages((prev) =>
      prev.map((ep) =>
        ep.id === id
          ? {
              ...ep,
              afterPage: Math.max(0, Math.min(pages.length, ep.afterPage + dir)),
            }
          : ep,
      ),
    );

  // Seiten-Reihenfolge: Auto-Seiten mit Leerseiten (per afterPage) verschränkt.
  type SeqItem =
    | { kind: "auto"; page: (typeof pages)[number] }
    | { kind: "blank"; extra: ExtraPage };
  const pageSequence = useMemo<SeqItem[]>(() => {
    const byAnchor = new Map<number, ExtraPage[]>();
    for (const ep of extraPages) {
      const arr = byAnchor.get(ep.afterPage) ?? [];
      arr.push(ep);
      byAnchor.set(ep.afterPage, arr);
    }
    const seq: SeqItem[] = [];
    for (const ep of byAnchor.get(0) ?? [])
      seq.push({ kind: "blank", extra: ep });
    const lastNum = pages.length ? pages[pages.length - 1].pageNumber : 0;
    for (const page of pages) {
      seq.push({ kind: "auto", page });
      for (const ep of byAnchor.get(page.pageNumber) ?? [])
        seq.push({ kind: "blank", extra: ep });
    }
    for (const [anchor, eps] of byAnchor) {
      if (anchor !== 0 && anchor > lastNum)
        for (const ep of eps) seq.push({ kind: "blank", extra: ep });
    }
    return seq;
  }, [pages, extraPages]);

  // Seitennummern über das GANZE Buch – in der echten Reihenfolge, also
  // einschließlich eingefügter Seiten. Vorher zählten nur die Auto-Seiten, wodurch
  // eingefügte Seiten gar keine Nummer hatten und die Zählung der Auto-Seiten nach
  // einer Einfügung nicht mehr zum gedruckten Buch passte.
  //
  // Das Titelblatt bleibt bewusst außen vor (es ist der Umschlag und trägt
  // üblicherweise keine Nummer). Achtung: Diese Zahlen sind reine ANZEIGE –
  // pageAlignments & Co. bleiben weiterhin über page.pageNumber adressiert.
  const bookNumbering = useMemo(() => {
    const perSheet = combinePages ? 2 : 1;
    const start = new Map<string, number>();
    let n = 1;
    for (const item of pageSequence) {
      const key =
        item.kind === "auto"
          ? `auto-${item.page.pageNumber}`
          : `blank-${item.extra.id}`;
      start.set(key, n);
      n += perSheet;
    }
    return { start, total: n - 1 };
  }, [pageSequence, combinePages]);

  /** Erste angezeigte Seitenzahl einer Auto-Seite. */
  const autoPageStart = (pageNumber: number): number =>
    bookNumbering.start.get(`auto-${pageNumber}`) ?? pageNumber;
  /** Erste angezeigte Seitenzahl einer eingefügten Seite. */
  const blankPageStart = (extraId: string): number =>
    bookNumbering.start.get(`blank-${extraId}`) ?? 0;


  // Fotos einer eingefügten Seite anordnen (Raster oder Collage).
  //
  // Auf eingefügten Seiten liegen Fotos als FREIE Elemente – sie durchlaufen das
  // Auto-Layout nicht, weshalb es dort bisher keinen Raster/Collage-Schalter gab.
  // Hier werden dieselben Layout-Engines wie für die Auto-Seiten benutzt: aus den
  // freien Bildern werden Pseudo-Assets (Id = Element-Id, Seitenverhältnis aus der
  // aktuellen Elementgröße), das Ergebnis wird auf die Elemente zurückgeschrieben.
  // Andere Elemente (Text, Formen, Emoji) bleiben unangetastet.
  const arrangeBlankPage = (
    extraId: string,
    mode: "justified" | "collage",
  ) => {
    const els = overlayElements[extraId] ?? [];
    const images = els.filter(isImageElement);
    if (images.length === 0) return;

    const pseudoAssets = images.map(
      (el) =>
        ({
          id: el.id,
          type: "IMAGE",
          exifInfo: {
            exifImageWidth: Math.max(1, Math.round(el.width)),
            exifImageHeight: Math.max(1, Math.round(el.height)),
            orientation: "1",
          },
        }) as unknown as AssetResponseDto,
    );

    // Zeilenhöhe so weit verkleinern, bis alles auf EINE Seite passt – sonst
    // würde die Engine umbrechen und ein Teil der Bilder läge außerhalb.
    let rowHeight = validRowHeight;
    let placed: PhotoBox[] = [];
    for (let i = 0; i < 24; i++) {
      const opts = {
        pageSize: "CUSTOM" as const,
        orientation: "portrait" as const,
        margin: validMargin,
        rowHeight,
        spacing: validSpacing,
        customWidth: blankPageWidthPx,
        customHeight: validPageHeight,
        combinePages: false,
      };
      const pages =
        mode === "collage"
          ? calculateCollageLayout(pseudoAssets, opts)
          : calculatePageLayout(pseudoAssets, opts);
      if (pages.length === 0) return;
      placed = pages[0].photos;
      if (pages.length === 1 && placed.length === images.length) break;
      rowHeight = Math.max(60, Math.round(rowHeight * 0.85));
    }

    const boxById = new Map(placed.map((b) => [b.asset.id, b]));
    setOverlayElements((prev) => ({
      ...prev,
      [extraId]: (prev[extraId] ?? []).map((el) => {
        const box = boxById.get(el.id);
        return box
          ? { ...el, x: box.x, y: box.y, width: box.width, height: box.height }
          : el;
      }),
    }));
    setSelectedElementId(null);
  };
  // Web-Render einer Leerseite (Kopf mit Steuerung + Canvas mit Overlay).
  const renderBlankPageWeb = (extra: ExtraPage) => (
    <div
      key={extra.id}
      id={`bookblank-${extra.id}`}
      // isolate: eigener Stacking-Context, damit die freien Elemente (z-40+)
      // nicht über die klebende Werkzeugleiste (z-30) hinausragen.
      className="relative isolate mb-10 scroll-mt-40"
    >
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        <span className="inline-block px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
          {combinePages
            ? `Seiten ${blankPageStart(extra.id)}–${blankPageStart(extra.id) + 1} von ${bookNumbering.total}`
            : `Seite ${blankPageStart(extra.id)} von ${bookNumbering.total}`}
        </span>
        <span className="text-xs text-stone-400">eingefügt</span>
        <button
          onClick={() => moveExtraPage(extra.id, -1)}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
          title="Eine Position nach vorne"
        >
          ←
        </button>
        <button
          onClick={() => moveExtraPage(extra.id, 1)}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
          title="Eine Position nach hinten"
        >
          →
        </button>
        <button
          onClick={() => handleInsertText(extra.id)}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
        >
          + Text
        </button>
        <button
          onClick={() => handleInsertShape(extra.id)}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
        >
          + Form
        </button>
        <label className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50 cursor-pointer">
          + Foto
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files)
                handleInsertImageFiles(e.target.files, extra.id);
              e.target.value = "";
            }}
          />
        </label>
        {/* Fotos dieser Seite anordnen – dieselben Engines wie bei Auto-Seiten. */}
        <span className="ml-1 text-xs text-stone-500">Anordnen:</span>
        <button
          onClick={() => arrangeBlankPage(extra.id, "justified")}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
          title="Fotos dieser Seite als Raster anordnen (gleichmäßige Zeilen)"
        >
          Raster
        </button>
        <button
          onClick={() => arrangeBlankPage(extra.id, "collage")}
          className="text-xs px-2 py-1 bg-white border border-stone-300 rounded hover:bg-stone-50"
          title="Fotos dieser Seite als Collage anordnen (unterschiedlich hohe Kacheln)"
        >
          Collage
        </button>
        <button
          onClick={() => deleteExtraPage(extra.id)}
          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
        >
          Entfernen
        </button>
      </div>
      <div
        className="relative shadow-lg mx-auto border border-stone-200"
        style={{
          width: `${blankDisplayW}px`,
          height: `${blankDisplayH}px`,
          ...webPageBackgroundStyle(pageBackground),
        }}
        onClick={() => setSelectedElementId(null)}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files?.length)
            handleInsertImageFiles(e.dataTransfer.files, extra.id);
        }}
      >
        {/* Falz/Bundsteg wie bei den Auto-Seiten – eine eingefügte Seite füllt
            im Doppelmodus ebenfalls die ganze Doppelseite. */}
        {combinePages && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-10"
            style={{
              left: `${blankDisplayW / 2 - 16}px`,
              width: "32px",
              background:
                "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.07) 38%, rgba(0,0,0,0.17) 50%, rgba(0,0,0,0.07) 62%, rgba(0,0,0,0) 100%)",
            }}
          />
        )}
        {renderOverlay(extra.id)}
      </div>
    </div>
  );


  /* ------------------------------------------------------------------ */
  /* Präsentation: dieselben Seiten, nur ohne Bedienelemente             */
  /* ------------------------------------------------------------------ */

  /** Ein Foto (oder Leerraum/Karte) rein zur Anzeige – ohne Griffe und Leisten. */
  const renderPresentBox = (photoBox: PhotoBox) => {
    const left = toPoints(photoBox.x);
    const top = toPoints(photoBox.y);
    const w = toPoints(photoBox.width);
    const h = toPoints(photoBox.height);
    const base = { position: "absolute" as const, left, top, width: w, height: h };

    if (isBlocker(photoBox.asset.id)) {
      const mapCfg = blockerMaps.get(photoBox.asset.id);
      if (mapCfg) {
        // Wie im PDF: der gespeicherte Kartenausschnitt, keine Live-Karte.
        return mapCfg.snapshot ? (
          <img
            key={photoBox.asset.id}
            src={mapCfg.snapshot}
            alt=""
            style={{ ...base, objectFit: "cover" }}
          />
        ) : null;
      }
      const bText = blockerTexts.get(photoBox.asset.id);
      const strokes = blockerDrawings.get(photoBox.asset.id) ?? [];
      // Gleiche Bedingung wie im PDF: ein Leerraum mit reinem Hintergrund (ohne
      // Text und Zeichnung) wird ebenfalls gezeichnet.
      if (!bText && strokes.length === 0) return null;
      return (
        <div
          key={photoBox.asset.id}
          style={{
            ...base,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
            overflow: "hidden",
            ...(bText?.backgroundColor && bText.backgroundColor !== "transparent"
              ? { backgroundColor: bText.backgroundColor }
              : {}),
          }}
        >
          {bText?.text && (
            <span
              className="whitespace-pre-wrap break-words text-center"
              style={{
                fontFamily: bText.fontFamily ?? "Roboto",
                fontSize: `${bText.fontSize ?? 28}px`,
                color: bText.color ?? "#1c1917",
              }}
            >
              {bText.text}
            </span>
          )}
          {strokes.length > 0 && (
            <svg
              className="absolute inset-0"
              width="100%"
              height="100%"
              viewBox={`0 0 ${w} ${h}`}
              preserveAspectRatio="none"
            >
              {strokes.map((s, si) => (
                <path
                  key={si}
                  d={strokeToPath(s.pts, w, h)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
          )}
        </div>
      );
    }

    const customCaption = imageCaptionTexts.get(photoBox.asset.id);
    const descPosition = descriptionPositions.get(photoBox.asset.id) || "bottom";
    const hasDescription =
      showDescriptions && !customCaption && !!photoBox.asset.exifInfo?.description;

    return (
      <div key={photoBox.asset.id} style={{ ...base, overflow: "hidden" }}>
        <WebElement
          element={photoBoxToImageElement(photoBox, 0)}
          ctx={{
            imageUrl: assetImageUrl(photoBox.asset.id),
            alt: photoBox.asset.originalFileName,
            descPosition,
            description: hasDescription
              ? photoBox.asset.exifInfo?.description
              : undefined,
            dateText: photoDateText(photoBox.asset),
            imageRotation: rotations.get(photoBox.asset.id),
            styles: webStyles,
            cropPosition: cropPositions.get(photoBox.asset.id),
          }}
        />
        {customCaption?.text && (
          <div
            className="absolute inset-x-0 bottom-0 whitespace-pre-wrap break-words px-1 text-center"
            style={{
              fontFamily: customCaption.fontFamily ?? "Roboto",
              fontSize: `${customCaption.fontSize ?? 14}px`,
              color: customCaption.color ?? "#1c1917",
              backgroundColor: customCaption.backgroundColor ?? "transparent",
            }}
          >
            {customCaption.text}
          </div>
        )}
      </div>
    );
  };

  /** Freie Elemente einer Seite, rein zur Anzeige. */
  const renderPresentOverlay = (pageKey: string) =>
    (overlayElements[pageKey] ?? []).map((el) => (
      <div
        key={el.id}
        className="absolute overflow-hidden"
        style={{ ...elementBoxStyle(el), zIndex: 40 + el.zIndex }}
      >
        {isImageElement(el) ? (
          <WebElement
            element={el}
            ctx={{
              imageUrl: el.src ?? assetImageUrl(el.assetId),
              descPosition: "bottom",
              styles: webStyles,
            }}
          />
        ) : isTextElement(el) ? (
          <WebTextElement element={el} />
        ) : isShapeElement(el) ? (
          <WebShapeElement element={el} />
        ) : isEmojiElement(el) ? (
          <WebEmojiElement element={el} />
        ) : null}
      </div>
    ));

  /**
   * Die Blätter der Präsentation – in derselben Reihenfolge wie im Buch.
   * Gerendert wird mit denselben Bausteinen wie Vorschau und PDF, nur ohne
   * Bedienelemente; es gibt also keinen zweiten Renderpfad.
   */
  const presentSheets = useMemo(() => {
    const sheets: { key: string; width: number; height: number; node: React.ReactNode }[] = [];

    if (titlePage) {
      sheets.push({
        key: "title",
        width: titleDisplayW,
        height: titleDisplayH,
        node: (
          <div
            className="relative h-full w-full overflow-hidden"
            style={webPageBackgroundStyle(pageBackground)}
          >
            {titlePage.imageSrc && (
              <img
                src={titlePage.imageSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-x-0 bottom-[12%] px-8 text-center">
              <div
                style={{
                  fontFamily: "Lora",
                  fontSize: 34,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: titleTextColor,
                }}
              >
                {titlePage.title}
              </div>
              {titlePage.subtitle && (
                <div
                  className="mt-2"
                  style={{ fontFamily: "Roboto", fontSize: 18, color: titleTextColor }}
                >
                  {titlePage.subtitle}
                </div>
              )}
            </div>
          </div>
        ),
      });
    }

    for (const item of pageSequence) {
      if (item.kind === "blank") {
        sheets.push({
          key: `blank-${item.extra.id}`,
          width: blankDisplayW,
          height: blankDisplayH,
          node: (
            <div
              className="relative h-full w-full overflow-hidden"
              style={webPageBackgroundStyle(pageBackground)}
            >
              {combinePages && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-10"
                  style={{
                    left: `${blankDisplayW / 2 - 16}px`,
                    width: "32px",
                    background:
                      "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.07) 38%, rgba(0,0,0,0.17) 50%, rgba(0,0,0,0.07) 62%, rgba(0,0,0,0) 100%)",
                  }}
                />
              )}
              {renderPresentOverlay(item.extra.id)}
            </div>
          ),
        });
      } else {
        const page = item.page;
        sheets.push({
          key: `page-${page.pageNumber}`,
          width: toPoints(page.width),
          height: toPoints(page.height),
          node: (
            <div
              className="relative h-full w-full overflow-hidden"
              style={webPageBackgroundStyle(pageBackground)}
            >
              {/* Falz/Bundsteg wie in der Vorschau – sonst wirkt die
                  Praesentation flacher als das Buch im Editor. */}
              {combinePages && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-10"
                  style={{
                    left: `${toPoints(page.width) / 2 - 16}px`,
                    width: "32px",
                    background:
                      "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.07) 38%, rgba(0,0,0,0.17) 50%, rgba(0,0,0,0.07) 62%, rgba(0,0,0,0) 100%)",
                  }}
                />
              )}
              {page.photos.map(renderPresentBox)}
              {renderPresentOverlay(String(page.pageNumber))}
            </div>
          ),
        });
      }
    }
    return sheets;
    // Bewusst breit: die Präsentation soll jede Änderung am Buch widerspiegeln.
  }, [
    pageSequence,
    titlePage,
    overlayElements,
    pageBackground,
    combinePages,
    rotations,
    cropPositions,
    imageCaptionTexts,
    blockerTexts,
    blockerDrawings,
    blockerMaps,
    descriptionPositions,
    showDescriptions,
    dateVisibility,
    showDates,
    webStyles,
    blankDisplayW,
    blankDisplayH,
    titleDisplayW,
    titleDisplayH,
    titleTextColor,
  ]);
  // PDF-Render einer Leerseite.
  const renderBlankPagePdf = (extra: ExtraPage) => (
    <Page
      key={extra.id}
      size={{
        width: toPoints(blankPageWidthPx),
        height: toPoints(validPageHeight),
      }}
      style={[staticStyles.page, { backgroundColor: PAGE_BG[pageBackground] }]}
    >
      {/* Falz/Bundsteg – wie bei den Auto-Seiten, damit eingefügte Seiten im
          Doppelmodus nicht flacher wirken als der Rest des Buchs. */}
      {combinePages && (
        <View
          style={{
            position: "absolute",
            left: toPoints(blankPageWidthPx) / 2 - 16,
            top: 0,
            width: 32,
            height: toPoints(validPageHeight),
          }}
        >
          <Svg width={32} height={toPoints(validPageHeight)}>
            <Defs>
              <LinearGradient id={`gutter-blank-${extra.id}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                <Stop offset="0.38" stopColor="#000000" stopOpacity={0.07} />
                <Stop offset="0.5" stopColor="#000000" stopOpacity={0.17} />
                <Stop offset="0.62" stopColor="#000000" stopOpacity={0.07} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect
              x={0}
              y={0}
              width={32}
              height={toPoints(validPageHeight)}
              fill={`url(#gutter-blank-${extra.id})`}
            />
          </Svg>
        </View>
      )}
      {renderPdfOverlay(extra.id)}
    </Page>
  );

  // Calculate total logical pages for display purposes
  const totalLogicalPages = combinePages ? pages.length * 2 : pages.length;

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-stone-200 border-t-primary-600"></div>
        <p className="mt-4 text-stone-600">Fotos werden geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <button
          onClick={onBack}
          className="mb-4 text-primary-600 hover:text-primary-800"
        >
          ← Zurück zu den Alben
        </button>
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={loadAlbumAssets}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm transition-colors shadow-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (mode !== "preview") return;
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (
          !e.relatedTarget ||
          !e.currentTarget.contains(e.relatedTarget as Node)
        ) {
          setIsDraggingFile(false);
        }
      }}
      onDrop={(e) => {
        if (mode !== "preview") return;
        e.preventDefault();
        setIsDraggingFile(false);
        if (e.dataTransfer.files?.length) {
          // Lokales Album: abgelegte Bilder werden echte Album-Fotos (Raster),
          // damit sie dauerhaft bleiben. Immich-Album: freies Overlay-Bild.
          if (isLocal) handleAddLocalPhotos(e.dataTransfer.files);
          else handleInsertImageFiles(e.dataTransfer.files);
        }
      }}
    >
      {isDraggingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary-600/10 border-4 border-dashed border-primary-600">
          <span className="rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-stone-700 shadow">
            Bild hier ablegen
          </span>
        </div>
      )}
      {/* Controls — bleibt beim Scrollen oben stehen (sticky). */}
      <div className="sticky top-0 z-30 -mx-4 mb-6 flex flex-col items-stretch gap-3 border-b border-stone-200 bg-stone-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="w-full">
          <button
            onClick={onBack}
            className="text-primary-600 hover:text-primary-800 mb-2"
          >
            ← Zurück zu den Alben
          </button>
          <h2 className="text-2xl font-semibold">{album.albumName}</h2>
          <p className="text-stone-600 mt-1">
            {filteredAssets.length !== assets.length
              ? `${filteredAssets.length} von ${assets.length} Fotos`
              : `${filteredAssets.length} Fotos`}
          </p>

          {/* Aktionsleiste — gruppiert: Primär · Ansicht · Einfügen · Übersicht · Einstellungen */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {mode === "preview" ? (
              <button
                onClick={() => setMode("pdf")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
              >
                <Icon path={mdiFileDownloadOutline} size={0.8} />
                PDF erzeugen
              </button>
            ) : (
              <button
                onClick={() => setMode("preview")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-700 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-stone-800"
              >
                <Icon path={mdiPencil} size={0.8} />
                Zurück zum Editor
              </button>
            )}

            {isLocal && (
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 ${
                  isUploadingLocal ? "pointer-events-none opacity-60" : ""
                }`}
                title="Weitere Fotos in dieses lokale Album hochladen"
              >
                <Icon path={mdiImagePlusOutline} size={0.8} />
                {isUploadingLocal
                  ? `Lädt… ${localUploadProgress?.done ?? 0}/${localUploadProgress?.total ?? 0}`
                  : "Fotos hinzufügen"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={isUploadingLocal}
                  onChange={(e) => {
                    if (e.target.files) handleAddLocalPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}

            {isLocal && immichAvailable && (
              <button
                onClick={openImmichImport}
                disabled={isUploadingLocal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-60"
                title="Fotos aus einem Immich-Album in dieses lokale Album übernehmen"
              >
                <Icon path={mdiImageMultipleOutline} size={0.8} />
                Aus Immich
              </button>
            )}

            {/* Ansicht: Einzel/Doppel */}
            <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white p-0.5 shadow-sm">
              <button
                onClick={() => setCombinePages(false)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  !combinePages
                    ? "bg-primary-600 text-white"
                    : "text-stone-600 hover:bg-stone-50"
                }`}
                title="Einzelseiten"
              >
                <Icon path={mdiFileOutline} size={0.7} />
                <span className="hidden sm:inline">Einzel</span>
              </button>
              <button
                onClick={() => setCombinePages(true)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  combinePages
                    ? "bg-primary-600 text-white"
                    : "text-stone-600 hover:bg-stone-50"
                }`}
                title="Doppelseiten (aufgeschlagenes Buch)"
              >
                <Icon path={mdiBookOpenOutline} size={0.7} />
                <span className="hidden sm:inline">Doppel</span>
              </button>
            </div>

            {/* Layout: Raster/Collage */}
            <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white p-0.5 shadow-sm">
              <button
                onClick={() => setLayoutMode("justified")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  layoutMode === "justified"
                    ? "bg-primary-600 text-white"
                    : "text-stone-600 hover:bg-stone-50"
                }`}
                title="Klassisches Zeilen-Layout"
              >
                <span className="hidden sm:inline">Raster</span>
                <span className="sm:hidden">▤</span>
              </button>
              <button
                onClick={() => setLayoutMode("collage")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  layoutMode === "collage"
                    ? "bg-primary-600 text-white"
                    : "text-stone-600 hover:bg-stone-50"
                }`}
                title="Collage: zeilenübergreifende Kacheln (Bilder verschieden hoch)"
              >
                <Icon path={mdiViewGridOutline} size={0.7} />
                <span className="hidden sm:inline">Collage</span>
              </button>
            </div>




            {/* Rückgängig – nimmt die letzten Bearbeitungsschritte zurück. */}
            {mode === "preview" && (
              <button
                onClick={handleUndo}
                disabled={undoDepth === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-40"
                title={
                  undoDepth === 0
                    ? "Nichts zum Zurücknehmen"
                    : `Letzten Schritt zurücknehmen (${undoDepth} verfügbar) — Strg+Z`
                }
              >
                <Icon path={mdiUndoVariant} size={0.8} />
                Rückgängig{undoDepth > 0 ? ` (${undoDepth})` : ""}
              </button>
            )}
            {/* Vollbild-Präsentation zum Blättern (Fernseher, Tablet). */}
            {mode === "preview" && (
              <button
                onClick={() => setPresenting(true)}
                disabled={presentSheets.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
                title="Buch im Vollbild durchblättern – für Fernseher und Tablet (Pfeiltasten, Wischen)"
              >
                <Icon path={mdiPresentationPlay} size={0.8} />
                Präsentieren
              </button>
            )}
            {/* Automatische Gestaltung des ganzen Buchs. */}
            {mode === "preview" && (
              <button
                onClick={handleAutoDesign}
                disabled={defaultFilteredAssets.length < 2}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 shadow-sm transition-colors hover:bg-primary-100 disabled:pointer-events-none disabled:opacity-50"
                title="Buch automatisch gestalten: Szenen erkennen, wichtige Fotos hervorheben, je Seite Raster oder Collage wählen"
              >
                <Icon path={mdiAutoFix} size={0.8} />
                Automatisch gestalten
              </button>
            )}
            {/* Einfügen-Menü */}
            {mode === "preview" && (
              <div className="relative">
                <button
                  onClick={() => {
                    setInsertMenuOpen((v) => !v);
                    setEmojiPickerOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50"
                >
                  <Icon path={mdiPlus} size={0.8} />
                  Einfügen
                  <Icon path={mdiChevronDown} size={0.6} />
                </button>
                {insertMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => {
                        setInsertMenuOpen(false);
                        setEmojiPickerOpen(false);
                      }}
                    />
                    <div className="absolute left-0 z-50 mt-1 w-56 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl">
                      {!emojiPickerOpen ? (
                        <>
                          <button
                            onClick={() => {
                              setShowImagePicker((v) => !v);
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiImagePlusOutline} size={0.8} /> Bild
                          </button>
                          <button
                            onClick={() => {
                              handleInsertText();
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiFormatText} size={0.8} /> Textfeld
                          </button>
                          <button
                            onClick={() => {
                              handleInsertShape();
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiShapePlusOutline} size={0.8} /> Form
                          </button>
                          <button
                            onClick={() => setEmojiPickerOpen(true)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiEmoticonOutline} size={0.8} /> Emoji
                            <Icon
                              path={mdiChevronDown}
                              size={0.6}
                              className="ml-auto -rotate-90"
                            />
                          </button>
                          <div className="my-1 border-t border-stone-100" />
                          <button
                            onClick={() => {
                              addBlankPage();
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiFileDocumentPlusOutline} size={0.8} />{" "}
                            Leere Seite
                          </button>
                          <button
                            onClick={() => {
                              handleAddBlocker();
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiVectorRectangle} size={0.8} /> Leerraum
                          </button>
                          <button
                            onClick={() => {
                              handleAddMap();
                              setInsertMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                          >
                            <Icon path={mdiMapMarkerOutline} size={0.8} /> Karte
                          </button>
                          {!titlePage && (
                            <button
                              onClick={() => {
                                setTitlePage({ title: "", subtitle: "" });
                                setInsertMenuOpen(false);
                              }}
                              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
                            >
                              <Icon
                                path={mdiBookOpenPageVariantOutline}
                                size={0.8}
                              />{" "}
                              Titelblatt
                            </button>
                          )}
                        </>
                      ) : (
                        <div>
                          <button
                            onClick={() => setEmojiPickerOpen(false)}
                            className="mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-stone-500 hover:text-stone-800"
                          >
                            <Icon path={mdiChevronLeft} size={0.6} /> zurück
                          </button>
                          <div className="grid grid-cols-7 gap-1">
                            {EMOJI_PALETTE.map((em) => (
                              <button
                                key={em}
                                onClick={() => {
                                  handleInsertEmoji(em);
                                  setInsertMenuOpen(false);
                                  setEmojiPickerOpen(false);
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-md text-xl leading-none hover:bg-stone-100"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Seiten-Übersicht */}
            {mode === "preview" && (
              <button
                onClick={() => setShowOverview((v) => !v)}
                className={`inline-flex items-center justify-center rounded-lg border p-2 shadow-sm transition-colors ${
                  showOverview
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                }`}
                title="Seiten-Übersicht"
                aria-label="Seiten-Übersicht"
              >
                <Icon path={mdiViewGridOutline} size={0.85} />
              </button>
            )}

            {excludedAssetIds.size > 0 && (
              <button
                onClick={() => setShowExcludedPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50"
                title="Aus dem Buch entfernte Bilder anzeigen / wiederherstellen"
              >
                <Icon path={mdiTrashCanOutline} size={0.7} />
                {excludedAssetIds.size}
              </button>
            )}

            {/* Einstellungen */}
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={`inline-flex items-center justify-center rounded-lg border p-2 shadow-sm transition-colors ${
                settingsOpen
                  ? "border-primary-500 bg-primary-50 text-primary-700"
                  : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
              }`}
              title="Einstellungen"
              aria-label="Einstellungen"
            >
              <Icon path={mdiCogOutline} size={0.85} />
            </button>
          </div>
        </div>

        <div className="w-full">
          {settingsOpen && (
            <div className="space-y-2">
              {/* 1. Page Setup */}
          <div className="p-2 bg-stone-50 rounded border border-stone-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                Seitenformat
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                {/* DIN-Format */}
                <select
                  value={currentDinFormat}
                  onChange={(e) => {
                    const fmt = e.target.value;
                    if (fmt === "custom") return; // cm-Felder erscheinen
                    applyPageSize(
                      dinToPx(fmt, isLandscape).width,
                      dinToPx(fmt, isLandscape).height,
                    );
                  }}
                  className="px-1 py-0.5 text-xs border border-stone-300 rounded bg-white"
                  title="Seitenformat"
                >
                  {Object.keys(DIN_FORMATS).map((f) => (
                    <option key={f} value={f}>
                      DIN {f}
                    </option>
                  ))}
                  <option value="custom">Benutzerdefiniert</option>
                </select>

                {/* Hoch/Quer */}
                <div className="flex gap-1">
                  {(
                    [
                      ["portrait", "Hoch"],
                      ["landscape", "Quer"],
                    ] as const
                  ).map(([val, label]) => {
                    const active =
                      (val === "landscape") === isLandscape;
                    return (
                      <button
                        key={val}
                        onClick={() => {
                          const landscape = val === "landscape";
                          if (landscape === isLandscape) return;
                          if (currentDinFormat !== "custom") {
                            const d = dinToPx(currentDinFormat, landscape);
                            applyPageSize(d.width, d.height);
                          } else {
                            applyPageSize(pageHeight, pageWidth); // Maße tauschen
                          }
                        }}
                        className={`px-2 py-0.5 text-xs rounded border ${
                          active
                            ? "bg-primary-500 text-white border-primary-500"
                            : "bg-white border-stone-300 hover:bg-stone-50"
                        }`}
                        title={label + "format"}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* cm-Felder nur bei benutzerdefiniert */}
                {currentDinFormat === "custom" && (
                  <>
                    <div className="flex items-center gap-1">
                      <label
                        htmlFor="pageWidth"
                        className="text-stone-600 text-xs"
                      >
                        B(cm):
                      </label>
                      <input
                        type="number"
                        id="pageWidth"
                        value={widthCmInput}
                        onChange={(e) => {
                          setWidthCmInput(e.target.value);
                          const cm = Number(e.target.value);
                          if (!isNaN(cm) && cm > 0) setPageWidth(cmToPx(cm));
                        }}
                        min="8"
                        max="85"
                        step="0.1"
                        className={`px-1 py-0.5 w-14 text-xs border rounded ${
                          isPageWidthValid
                            ? "border-stone-300"
                            : "border-red-500 bg-red-50"
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label
                        htmlFor="pageHeight"
                        className="text-stone-600 text-xs"
                      >
                        H(cm):
                      </label>
                      <input
                        type="number"
                        id="pageHeight"
                        value={heightCmInput}
                        onChange={(e) => {
                          setHeightCmInput(e.target.value);
                          const cm = Number(e.target.value);
                          if (!isNaN(cm) && cm > 0) setPageHeight(cmToPx(cm));
                        }}
                        min="8"
                        max="85"
                        step="0.1"
                        className={`px-1 py-0.5 w-14 text-xs border rounded ${
                          isPageHeightValid
                            ? "border-stone-300"
                            : "border-red-500 bg-red-50"
                        }`}
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="combinePages"
                    checked={combinePages}
                    onChange={(e) => setCombinePages(e.target.checked)}
                    className="h-3 w-3 accent-primary-600"
                  />
                  <label
                    htmlFor="combinePages"
                    className="text-xs text-stone-700"
                  >
                    Seiten kombinieren
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Layout */}
          <div className="p-2 bg-stone-50 rounded border border-stone-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                Layout (px)
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="margin" className="text-stone-600 text-xs">
                    Rand:
                  </label>
                  <input
                    type="number"
                    id="margin"
                    value={margin}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setMargin(value);
                      }
                    }}
                    min="0"
                    max={pageWidth / 2}
                    step="10"
                    className={`px-1 py-0.5 w-14 text-xs border rounded ${
                      isMarginValid
                        ? "border-stone-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="rowHeight" className="text-stone-600 text-xs">
                    Zeilenhöhe:
                  </label>
                  <input
                    type="number"
                    id="rowHeight"
                    value={rowHeight}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setRowHeight(value);
                      }
                    }}
                    min="300"
                    max={pageHeight}
                    step="10"
                    className={`px-1 py-0.5 w-14 text-xs border rounded ${
                      isRowHeightValid
                        ? "border-stone-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="spacing" className="text-stone-600 text-xs">
                    Abstand:
                  </label>
                  <input
                    type="number"
                    id="spacing"
                    value={spacing}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setSpacing(value);
                      }
                    }}
                    min="0"
                    max="100"
                    className={`px-1 py-0.5 w-12 text-xs border rounded ${
                      isSpacingValid
                        ? "border-stone-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. Presentation */}
          <div className="p-2 bg-stone-50 rounded border border-stone-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                Darstellung
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="filterVideos"
                    checked={filterVideos}
                    onChange={(e) => setFilterVideos(e.target.checked)}
                    className="h-3 w-3 accent-primary-600"
                  />
                  <label
                    htmlFor="filterVideos"
                    className="text-xs text-stone-700"
                  >
                    Videos ausschließen
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="showDates"
                    checked={showDates}
                    onChange={(e) => setShowDates(e.target.checked)}
                    className="h-3 w-3 accent-primary-600"
                  />
                  <label htmlFor="showDates" className="text-xs text-stone-700">
                    Datum zeigen
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="showDescriptions"
                    checked={showDescriptions}
                    onChange={(e) => setShowDescriptions(e.target.checked)}
                    className="h-3 w-3 accent-primary-600"
                  />
                  <label
                    htmlFor="showDescriptions"
                    className="text-xs text-stone-700"
                  >
                    Beschreibungen zeigen
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="fontSize" className="text-stone-600 text-xs">
                    Schriftgröße:
                  </label>
                  <select
                    id="fontSize"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="px-1 py-0.5 text-xs border border-stone-300 rounded"
                  >
                    <option value="8">8 pt</option>
                    <option value="9">9 pt</option>
                    <option value="10">10 pt</option>
                    <option value="11">11 pt</option>
                    <option value="12">12 pt</option>
                    <option value="14">14 pt</option>
                    <option value="16">16 pt</option>
                    <option value="18">18 pt</option>
                    <option value="20">20 pt</option>
                    <option value="22">22 pt</option>
                    <option value="24">24 pt</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Seitenfarbe (ganzes Buch) */}
          <div className="p-2 bg-stone-50 rounded border border-stone-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                Seitenfarbe
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["white", "Weiß"],
                    ["cream", "Creme"],
                    ["darkbrown", "Dunkelbraun"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setPageBackground(val)}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                      pageBackground === val
                        ? "border-primary-600 ring-1 ring-primary-600 text-stone-800"
                        : "border-stone-300 text-stone-600 hover:bg-stone-100"
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-sm border border-stone-300"
                      style={webPageBackgroundStyle(val)}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Customizations (only shown when there are any) */}
          {(customAspectRatios.size > 0 ||
            customOrdering !== null ||
            descriptionPositions.size > 0) && (
            <div className="p-2 bg-stone-50 rounded border border-stone-300">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                  Anpassungen
                </h3>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {customOrdering !== null && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-stone-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Eigene Reihenfolge
                      </span>
                      <button
                        onClick={handleResetOrdering}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  )}
                  {customAspectRatios.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-stone-600">
                        <span className="w-2 h-2 bg-primary-500 rounded-full" />
                        {customAspectRatios.size} Seitenverhältnis
                      </span>
                      <button
                        onClick={handleResetAllCustomizations}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  )}
                  {descriptionPositions.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-stone-600">
                        <span className="w-2 h-2 bg-purple-500 rounded-full" />
                        {descriptionPositions.size} Label-Position
                      </span>
                      <button
                        onClick={handleResetDescriptionPositions}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
            </div>
          )}
        </div>
      </div>

      {showImagePicker && (
        <div className="mb-6 p-3 bg-stone-50 border border-stone-300 rounded">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-stone-700">
              Bild platzieren — Album-Bild wählen oder eigene Datei laden
            </h3>
            <div className="flex items-center gap-3">
              <label className="text-xs px-2 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded cursor-pointer transition-colors">
                Eigene Datei…
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      if (isLocal) {
                        handleAddLocalPhotos(e.target.files);
                        setShowImagePicker(false);
                      } else handleInsertImageFiles(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                onClick={() => setShowImagePicker(false)}
                className="text-xs text-stone-500 hover:text-stone-700"
              >
                Schließen
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 max-h-64 overflow-y-auto">
            {assets
              .filter((a) => a.type === "IMAGE")
              .map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => handleInsertImage(asset)}
                  className="relative w-24 h-24 rounded border border-stone-300 overflow-hidden hover:ring-2 hover:ring-primary-500 transition"
                  title="Frei einfügen"
                >
                  <img
                    src={assetImageUrl(asset.id)}
                    alt={asset.originalFileName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
          </div>
        </div>
      )}

      {presenting && (
        <BookPresenter
          sheets={presentSheets}
          stageColor={pageBackground === "darkbrown" ? "#0b0a09" : "#111310"}
          onClose={() => setPresenting(false)}
        />
      )}

      {/* Rückmeldung der automatischen Gestaltung – mit einem Klick zurücknehmbar. */}
      {designNote && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
          <Icon path={mdiAutoFix} size={0.8} className="text-primary-700" />
          <span className="text-sm text-primary-900">{designNote}</span>
          <span className="ml-auto flex items-center gap-2">
            {designUndo && (
              <button
                onClick={handleUndoAutoDesign}
                className="rounded border border-primary-300 bg-white px-2.5 py-1 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-50"
                title="Reihenfolge, Hervorhebungen, Umbrüche und Seitenmodi wieder auf den Stand davor setzen"
              >
                Rückgängig
              </button>
            )}
            <button
              onClick={() => setDesignNote(null)}
              className="text-xs text-primary-700 transition-colors hover:text-primary-900"
            >
              Schließen
            </button>
          </span>
        </div>
      )}

      {showImmichImport && (
        <div className="mb-6 rounded border border-stone-300 bg-stone-50 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-stone-700">
              {immichMode === "unassigned"
                ? "Aus Immich übernehmen — Fotos ohne Album"
                : immichSource
                  ? `Aus Immich übernehmen — ${immichSource.albumName}`
                  : "Aus Immich übernehmen — Album wählen"}
            </h3>
            <div className="flex items-center gap-3">
              {immichMode === "album" && immichSource && (
                <button
                  onClick={() => {
                    setImmichSource(null);
                    setImmichPicked(new Set());
                  }}
                  className="text-xs text-stone-500 transition-colors hover:text-stone-700"
                >
                  ← Alben
                </button>
              )}
              <button
                onClick={() => setShowImmichImport(false)}
                className="text-xs text-stone-500 transition-colors hover:text-stone-700"
              >
                Schließen
              </button>
            </div>
          </div>

          {/* Quelle: Fotos ohne Album (Standard) oder gezielt aus einem Album. */}
          <div className="mb-3 inline-flex items-center rounded-lg border border-stone-300 bg-white p-0.5 shadow-sm">
            <button
              onClick={() => {
                setImmichMode("unassigned");
                setImmichSource(null);
                setImmichPicked(new Set());
                setImmichError(null);
                if (immichLoose.length === 0) loadLooseAssets(false);
              }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                immichMode === "unassigned"
                  ? "bg-primary-600 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
              title="Fotos, die in keinem Immich-Album liegen"
            >
              Ohne Album
            </button>
            <button
              onClick={openImmichAlbumMode}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                immichMode === "album"
                  ? "bg-primary-600 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
              title="Fotos aus einem bestimmten Immich-Album"
            >
              Aus Album
            </button>
          </div>

          {immichError && (
            <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
              {immichError}
            </p>
          )}

          {immichBusy && immichPickable.length === 0 && (
            <p className="py-4 text-center text-sm text-stone-500">Lädt…</p>
          )}

          {/* Album-Modus, Schritt 1: Album auswählen */}
          {immichMode === "album" && !immichSource && !immichBusy && (
            <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
              {(immichAlbums ?? []).length === 0 ? (
                <p className="text-sm text-stone-500">
                  Keine Immich-Alben gefunden.
                </p>
              ) : (
                (immichAlbums ?? []).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => openImmichSource(a.id)}
                    className="rounded border border-stone-300 bg-white px-3 py-2 text-left text-sm text-stone-700 shadow-sm transition-colors hover:border-primary-400 hover:bg-primary-50/40"
                  >
                    <span className="font-medium">{a.albumName}</span>
                    <span className="ml-2 text-xs text-stone-500">
                      {a.assetCount} Fotos
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Fotoauswahl — gilt für beide Quellen. */}
          {(immichMode === "unassigned" || immichSource) && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <button
                  onClick={() =>
                    setImmichPicked(
                      immichPicked.size === immichPickable.length
                        ? new Set()
                        : new Set(immichPickable.map((a) => a.id)),
                    )
                  }
                  disabled={immichPickable.length === 0}
                  className="text-xs text-primary-700 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {immichPicked.size === immichPickable.length &&
                  immichPickable.length > 0
                    ? "Auswahl aufheben"
                    : "Alle auswählen"}
                </button>
                <span className="text-xs text-stone-500">
                  {immichPicked.size} von {immichPickable.length} gewählt
                  {immichMode === "unassigned" && immichLooseMore && " (weitere vorhanden)"}
                </span>
                <button
                  onClick={handleImportFromImmich}
                  disabled={immichPicked.size === 0 || isUploadingLocal}
                  className="ml-auto rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                >
                  {isUploadingLocal
                    ? `Übernimmt… ${localUploadProgress?.done ?? 0}/${localUploadProgress?.total ?? 0}`
                    : `${immichPicked.size} Foto(s) übernehmen`}
                </button>
              </div>

              {immichPickable.length === 0 && !immichBusy ? (
                <p className="py-4 text-center text-sm text-stone-500">
                  {immichMode === "unassigned"
                    ? "Alle Fotos in Immich liegen bereits in einem Album."
                    : "Dieses Album enthält keine Fotos."}
                </p>
              ) : (
                <div className="flex max-h-64 flex-wrap gap-3 overflow-y-auto">
                  {immichPickable.map((asset) => {
                    const picked = immichPicked.has(asset.id);
                    return (
                      <button
                        key={asset.id}
                        onClick={() =>
                          setImmichPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(asset.id)) next.delete(asset.id);
                            else next.add(asset.id);
                            return next;
                          })
                        }
                        className={`relative h-24 w-24 overflow-hidden rounded border transition ${
                          picked
                            ? "border-primary-500 ring-2 ring-primary-500"
                            : "border-stone-300 hover:ring-2 hover:ring-primary-300"
                        }`}
                        title={asset.originalFileName}
                      >
                        <img
                          src={`${immichConfig.baseUrl}/assets/${asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`}
                          alt={asset.originalFileName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        {picked && (
                          <span className="absolute right-1 top-1 rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {immichMode === "unassigned" && immichLooseMore && (
                <div className="mt-2 text-center">
                  <button
                    onClick={() => loadLooseAssets(true)}
                    disabled={immichBusy}
                    className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:opacity-50"
                  >
                    {immichBusy ? "Lädt…" : "Mehr laden"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showExcludedPanel && (
        <div className="mb-6 p-3 bg-stone-50 border border-stone-300 rounded">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-stone-700">
              Aus dem Buch entfernt ({excludedAssetIds.size}) — bleiben in Immich
            </h3>
            <button
              onClick={() => setShowExcludedPanel(false)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              Schließen
            </button>
          </div>
          {excludedAssetIds.size === 0 ? (
            <p className="text-xs text-stone-500">Keine entfernten Bilder.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {assets
                .filter((a) => excludedAssetIds.has(a.id))
                .map((asset) => (
                  <div key={asset.id} className="relative w-24 h-24 group">
                    <img
                      src={assetImageUrl(asset.id)}
                      alt={asset.originalFileName}
                      className="w-full h-full object-cover rounded border border-stone-300"
                      loading="lazy"
                    />
                    <button
                      onClick={() => handleRestoreAsset(asset.id)}
                      className="absolute inset-x-0 bottom-0 bg-primary-600/90 hover:bg-primary-700 text-white text-[10px] py-1 rounded-b opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Wiederherstellen
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {mode === "pdf" ? (
        /* PDF Viewer */
        <div
          className="w-full"
          style={{ height: "calc(100vh - 200px)", minHeight: "400px" }}
        >
          <PDFViewer width="100%" height="100%" showToolbar={true}>
            <Document pageLayout={pageLayout}>
              {titlePage && (
                <Page
                  size={{
                    width: toPoints(titlePageWidthPx),
                    height: toPoints(titlePageHeightPx),
                  }}
                  style={[
                    staticStyles.page,
                    { backgroundColor: PAGE_BG[pageBackground] },
                  ]}
                >
                  {titlePage.title.trim().length > 0 && (
                    <Text
                      style={{
                        position: "absolute",
                        top: toPoints(titlePageHeightPx) * 0.08,
                        left: "8%",
                        width: "84%",
                        textAlign: "center",
                        fontSize: toPoints(titlePageHeightPx) * 0.06,
                        fontFamily: "Roboto",
                        fontWeight: 700,
                        color: titleTextColor,
                      }}
                    >
                      {titlePage.title}
                    </Text>
                  )}
                  {titlePage.imageSrc && (
                    <PdfImage
                      src={titlePage.imageSrc}
                      style={{
                        position: "absolute",
                        top: toPoints(titlePageHeightPx) * 0.26,
                        left: "18%",
                        width: "64%",
                        height: toPoints(titlePageHeightPx) * 0.48,
                        objectFit: "contain",
                      }}
                    />
                  )}
                  {titlePage.subtitle.trim().length > 0 && (
                    <Text
                      style={{
                        position: "absolute",
                        top: toPoints(titlePageHeightPx) * 0.78,
                        left: "12%",
                        width: "76%",
                        textAlign: "center",
                        fontSize: toPoints(titlePageHeightPx) * 0.03,
                        fontFamily: "Roboto",
                        color: titleTextColor,
                      }}
                    >
                      {titlePage.subtitle}
                    </Text>
                  )}
                </Page>
              )}
              {pageSequence.map((item) => {
                if (item.kind === "blank")
                  return renderBlankPagePdf(item.extra);
                const pageData = item.page;
                // FIXME: pdfkit (internal of react-pdf) uses 72dpi internally and we downscale everything here;
                // instead we should produce a high-quality 300 dpi pdf

                // Convert page dimensions from 300 DPI to 72 DPI
                const pageWidth = toPoints(pageData.width);
                const pageHeight = toPoints(pageData.height);
                return (
                  <Page
                    key={pageData.pageNumber}
                    size={{
                      width: pageWidth,
                      height: pageHeight,
                    }}
                    style={[
                      staticStyles.page,
                      { backgroundColor: PAGE_BG[pageBackground] },
                    ]}
                  >
                    {/* Falz/Bundsteg-Schattierung im Spread (3D-Effekt) */}
                    {combinePages && (
                      <View
                        style={{
                          position: "absolute",
                          left: pageWidth / 2 - 16,
                          top: 0,
                          width: 32,
                          height: pageHeight,
                        }}
                      >
                        <Svg width={32} height={pageHeight}>
                          <Defs>
                            <LinearGradient
                              id={`gutter-${pageData.pageNumber}`}
                              x1="0"
                              y1="0"
                              x2="1"
                              y2="0"
                            >
                              <Stop
                                offset="0"
                                stopColor="#000000"
                                stopOpacity={0}
                              />
                              <Stop
                                offset="0.5"
                                stopColor="#000000"
                                stopOpacity={0.16}
                              />
                              <Stop
                                offset="1"
                                stopColor="#000000"
                                stopOpacity={0}
                              />
                            </LinearGradient>
                          </Defs>
                          <Rect
                            x={0}
                            y={0}
                            width={32}
                            height={pageHeight}
                            fill={`url(#gutter-${pageData.pageNumber})`}
                          />
                        </Svg>
                      </View>
                    )}

                    {pageData.photos.map((photoBox) => {
                      // Blocker: leerer Platz; mit optionalem Freitext (Leerraum).
                      if (isBlocker(photoBox.asset.id)) {
                        // Karten-Leerraum: gespeicherten Schnappschuss einbetten.
                        const mapCfg = blockerMaps.get(photoBox.asset.id);
                        if (mapCfg) {
                          if (!mapCfg.snapshot) return null;
                          return (
                            <PdfImage
                              key={photoBox.asset.id}
                              src={mapCfg.snapshot}
                              style={{
                                position: "absolute",
                                left: toPoints(photoBox.x),
                                top: toPoints(photoBox.y),
                                width: toPoints(photoBox.width),
                                height: toPoints(photoBox.height),
                                objectFit: "cover",
                              }}
                            />
                          );
                        }
                        const bText = blockerTexts.get(photoBox.asset.id);
                        const bStrokes =
                          blockerDrawings.get(photoBox.asset.id) ?? [];
                        if (!bText && bStrokes.length === 0) return null;
                        const bw = toPoints(photoBox.width);
                        const bh = toPoints(photoBox.height);
                        return (
                          <View
                            key={photoBox.asset.id}
                            style={{
                              position: "absolute",
                              left: toPoints(photoBox.x),
                              top: toPoints(photoBox.y),
                              width: bw,
                              height: bh,
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 8,
                              ...(bText?.backgroundColor &&
                              bText.backgroundColor !== "transparent"
                                ? { backgroundColor: bText.backgroundColor }
                                : {}),
                            }}
                          >
                            {bText && (
                              <Text
                                style={{
                                  fontFamily: bText.fontFamily ?? "Roboto",
                                  fontSize: bText.fontSize ?? 28,
                                  color: bText.color ?? "#1c1917",
                                  textAlign: "center",
                                }}
                              >
                                {bText.text}
                              </Text>
                            )}
                            {bStrokes.length > 0 && (
                              <Svg
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                }}
                                width={bw}
                                height={bh}
                                viewBox={`0 0 ${bw} ${bh}`}
                              >
                                {bStrokes.map((s, si) => (
                                  <Path
                                    key={si}
                                    d={strokeToPath(s.pts, bw, bh)}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth={s.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ))}
                              </Svg>
                            )}
                          </View>
                        );
                      }
                      const imageUrl = assetImageUrl(photoBox.asset.id);
                      const customCaption = imageCaptionTexts.get(
                        photoBox.asset.id,
                      );
                      const descPosition =
                        descriptionPositions.get(photoBox.asset.id) || "bottom";
                      const hasDescription =
                        showDescriptions &&
                        !customCaption &&
                        !!photoBox.asset.exifInfo?.description;
                      return (
                        <Fragment key={photoBox.asset.id}>
                          <PdfElement
                            element={photoBoxToImageElement(photoBox, 0)}
                            ctx={{
                              imageUrl,
                              descPosition,
                              description: hasDescription
                                ? photoBox.asset.exifInfo?.description
                                : undefined,
                              dateText: photoDateText(photoBox.asset),
                              imageRotation: rotations.get(photoBox.asset.id),
                              styles: pdfStyles,
                              cropPosition: cropPositions.get(photoBox.asset.id),
                            }}
                          />
                          {customCaption && (
                            <View
                              style={{
                                position: "absolute",
                                left: toPoints(photoBox.x),
                                top:
                                  toPoints(photoBox.y + photoBox.height) -
                                  (customCaption.fontSize ?? 14) * 1.8,
                                width: toPoints(photoBox.width),
                                paddingHorizontal: 4,
                                paddingVertical: 3,
                                backgroundColor:
                                  customCaption.backgroundColor ??
                                  "rgba(255,255,255,0.7)",
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: customCaption.fontFamily ?? "Roboto",
                                  fontSize: customCaption.fontSize ?? 14,
                                  color: customCaption.color ?? "#000000",
                                  textAlign: "center",
                                }}
                              >
                                {customCaption.text}
                              </Text>
                            </View>
                          )}
                        </Fragment>
                      );
                    })}
                    {renderPdfOverlay(String(pageData.pageNumber))}
                  </Page>
                );
              })}
            </Document>
          </PDFViewer>
        </div>
      ) : (
        /* Live Preview */
        <div
          className="space-y-8 pb-8 overflow-x-auto px-4 sm:px-0"
          onClick={() => {
            setSelectedElementId(null);
            finishTextEditing();
            setDrawingBlockerId(null);
          }}
        >
          {/* Seiten-Übersicht (Navigator) */}
          {showOverview && (
            <div
              className="fixed right-0 top-0 bottom-0 z-40 flex w-60 flex-col border-l border-stone-200 bg-white/95 shadow-xl backdrop-blur"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
                <span className="text-sm font-semibold text-stone-700">
                  Seiten-Übersicht
                </span>
                <button
                  onClick={() => setShowOverview(false)}
                  className="rounded p-1 text-stone-500 hover:bg-stone-100"
                  aria-label="Übersicht schließen"
                >
                  <Icon path={mdiClose} size={0.8} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-2 gap-2">
                  {titlePage && (
                    <button
                      onClick={() =>
                        document
                          .getElementById("bookpage-title")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                      className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 p-1.5 hover:border-primary-400 hover:bg-primary-50"
                    >
                      <span className="flex h-16 w-full items-center justify-center rounded bg-stone-100 text-stone-400">
                        <Icon path={mdiBookOpenPageVariantOutline} size={0.9} />
                      </span>
                      <span className="text-[11px] text-stone-600">Titel</span>
                    </button>
                  )}
                  {pageSequence.map((item) => {
                    if (item.kind === "blank") {
                      return (
                        <button
                          key={item.extra.id}
                          onClick={() =>
                            document
                              .getElementById(`bookblank-${item.extra.id}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                          }
                          className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-stone-300 p-1.5 hover:border-primary-400 hover:bg-primary-50"
                        >
                          <span className="flex h-16 w-full items-center justify-center rounded bg-stone-50 text-stone-400">
                            <Icon path={mdiFileDocumentPlusOutline} size={0.9} />
                          </span>
                          <span className="text-[11px] text-stone-600">
                            Leerseite
                          </span>
                        </button>
                      );
                    }
                    const p = item.page;
                    const firstPhoto = p.photos.find(
                      (ph) => !isBlocker(ph.asset.id),
                    );
                    const thumb = firstPhoto
                      ? assetImageUrl(firstPhoto.asset.id)
                      : null;
                    return (
                      <button
                        key={p.pageNumber}
                        onClick={() =>
                          document
                            .getElementById(`bookpage-${p.pageNumber}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            })
                        }
                        className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 p-1.5 hover:border-primary-400 hover:bg-primary-50"
                      >
                        <span className="block h-16 w-full overflow-hidden rounded bg-stone-100">
                          {thumb && (
                            <img
                              src={thumb}
                              loading="lazy"
                              className="h-full w-full object-cover"
                              draggable={false}
                            />
                          )}
                        </span>
                        <span className="text-[11px] text-stone-600">
                          {p.pageNumber}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Werkzeugleiste Zeichenzone */}
          {drawingBlockerId && (
            <div
              className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-stone-300 bg-white/95 px-3 py-1.5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-xs font-medium text-stone-500">Stift</span>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPenColor(c)}
                  className={`h-5 w-5 rounded-full border ${
                    penColor === c
                      ? "ring-2 ring-primary-500 ring-offset-1"
                      : "border-stone-300"
                  }`}
                  style={{ backgroundColor: c }}
                  title={`Farbe ${c}`}
                />
              ))}
              <input
                type="color"
                value={penColor}
                onChange={(e) => setPenColor(e.target.value)}
                title="Eigene Farbe"
                className="h-6 w-7 cursor-pointer"
              />
              <span className="ml-1 text-xs text-stone-500">Breite</span>
              {PEN_WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setPenWidth(w)}
                  className={`flex h-6 w-6 items-center justify-center rounded border ${
                    penWidth === w
                      ? "bg-primary-500 border-primary-500"
                      : "bg-white border-stone-300 hover:bg-stone-50"
                  }`}
                  title={`Strichbreite ${w}`}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: `${Math.min(14, w + 2)}px`,
                      height: `${Math.min(14, w + 2)}px`,
                      backgroundColor: penWidth === w ? "#fff" : "#57534e",
                    }}
                  />
                </button>
              ))}
              <button
                onClick={() => undoStroke(drawingBlockerId)}
                className="text-xs px-2 py-0.5 bg-white border border-stone-300 rounded hover:bg-stone-50"
                title="Letzten Strich zurücknehmen"
              >
                Rückgängig
              </button>
              <button
                onClick={() => clearStrokes(drawingBlockerId)}
                className="text-xs px-2 py-0.5 bg-white border border-stone-300 rounded hover:bg-stone-50"
                title="Alle Striche löschen"
              >
                Leeren
              </button>
              <button
                onClick={() => setDrawingBlockerId(null)}
                className="text-xs px-2 py-0.5 bg-primary-600 hover:bg-primary-700 text-white rounded"
              >
                Fertig
              </button>
            </div>
          )}

          {/* Stil-Leiste für Leerraum-Text / Bildunterschrift */}
          {(editingBlockerId || editingCaptionAssetId) &&
            (() => {
              const st = editingBlockerId
                ? blockerTexts.get(editingBlockerId)
                : editingCaptionAssetId
                  ? imageCaptionTexts.get(editingCaptionAssetId)
                  : undefined;
              const defSize = editingBlockerId ? 28 : fontSize;
              return (
                <div
                  className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded border border-stone-300 bg-white/95 px-3 py-1.5 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-stone-500">
                    {editingBlockerId ? "Leerraum" : "Beschriftung"}
                  </span>
                  <select
                    value={st?.fontFamily ?? "Roboto"}
                    onChange={(e) =>
                      patchActiveStyle({ fontFamily: e.target.value })
                    }
                    className="rounded border border-stone-300 px-1 py-0.5 text-xs"
                    title="Schriftart"
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={6}
                    value={st?.fontSize ?? defSize}
                    onChange={(e) =>
                      patchActiveStyle({
                        fontSize: Math.max(6, Number(e.target.value) || defSize),
                      })
                    }
                    className="w-14 rounded border border-stone-300 px-1 py-0.5 text-xs"
                    title="Schriftgröße"
                  />
                  <input
                    type="color"
                    value={st?.color ?? "#292524"}
                    onChange={(e) => patchActiveStyle({ color: e.target.value })}
                    className="h-6 w-8 cursor-pointer"
                    title="Textfarbe"
                  />
                  <label
                    className="flex items-center gap-1 text-xs text-stone-600"
                    title="Textfeld-Hintergrund"
                  >
                    Hg
                    <input
                      type="color"
                      value={st?.backgroundColor ?? "#ffffff"}
                      onChange={(e) =>
                        patchActiveStyle({ backgroundColor: e.target.value })
                      }
                      className="h-6 w-8 cursor-pointer"
                    />
                  </label>
                  <button
                    onClick={() =>
                      patchActiveStyle({ backgroundColor: "transparent" })
                    }
                    className={`rounded border px-1.5 py-0.5 text-xs hover:bg-stone-50 ${
                      st?.backgroundColor === "transparent"
                        ? "border-primary-500 bg-primary-50 text-primary-700"
                        : "border-stone-300"
                    }`}
                    title="Hintergrund transparent (Seite scheint durch)"
                  >
                    Transparent
                  </button>
                  <button
                    onClick={() => finishTextEditing()}
                    className="rounded bg-primary-600 px-2 py-0.5 text-xs text-white hover:bg-primary-700"
                  >
                    Fertig
                  </button>
                </div>
              );
            })()}
          {selectedElementId && (
            <div
              className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded border border-stone-300 bg-white/95 px-3 py-1.5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {selectedElement && isTextElement(selectedElement) ? (
                <>
                  <input
                    type="text"
                    value={selectedElement.text}
                    onChange={(e) =>
                      updateTextElement(selectedElementId, () => ({
                        text: e.target.value,
                      }))
                    }
                    placeholder="Text eingeben…"
                    className="text-xs border border-stone-300 rounded px-1 py-0.5 w-44"
                  />
                  {/* Schriftart – TextElement.fontFamily wurde zwar gespeichert und
                      von Vorschau UND PDF ausgewertet, war hier aber nie einstellbar. */}
                  <select
                    value={selectedElement.fontFamily}
                    onChange={(e) =>
                      updateTextElement(selectedElementId, () => ({
                        fontFamily: e.target.value,
                      }))
                    }
                    className="text-xs border border-stone-300 rounded px-1 py-0.5"
                    title="Schriftart"
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={selectedElement.fontSize}
                    min={6}
                    onChange={(e) =>
                      updateTextElement(selectedElementId, () => ({
                        fontSize: Math.max(6, Number(e.target.value) || 24),
                      }))
                    }
                    className="text-xs border border-stone-300 rounded px-1 py-0.5 w-14"
                    title="Schriftgröße"
                  />
                  <input
                    type="color"
                    value={selectedElement.color}
                    onChange={(e) =>
                      updateTextElement(selectedElementId, () => ({
                        color: e.target.value,
                      }))
                    }
                    title="Textfarbe"
                    className="h-6 w-8 cursor-pointer"
                  />
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() =>
                        updateTextElement(selectedElementId, () => ({ align: a }))
                      }
                      className={`text-xs px-2 py-0.5 rounded border ${
                        selectedElement.align === a
                          ? "bg-primary-500 text-white border-primary-500"
                          : "bg-white border-stone-300 hover:bg-stone-50"
                      }`}
                      title={`Ausrichtung ${a}`}
                    >
                      {a === "left" ? "L" : a === "center" ? "Z" : "R"}
                    </button>
                  ))}
                  <button
                    onClick={() => refixElement(selectedElementId)}
                    className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded"
                    title="Textfeld entfernen"
                  >
                    Entfernen
                  </button>
                </>
              ) : selectedElement && isShapeElement(selectedElement) ? (
                <>
                  {(["rect", "ellipse", "line"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        updateShapeElement(selectedElementId, () => ({
                          shape: s,
                        }))
                      }
                      className={`text-xs px-2 py-0.5 rounded border ${
                        selectedElement.shape === s
                          ? "bg-primary-500 text-white border-primary-500"
                          : "bg-white border-stone-300 hover:bg-stone-50"
                      }`}
                      title={`Form: ${s}`}
                    >
                      {s === "rect" ? "▭" : s === "ellipse" ? "◯" : "—"}
                    </button>
                  ))}
                  <label className="text-xs text-stone-600 flex items-center gap-1">
                    Füllung
                    <input
                      type="color"
                      value={selectedElement.fill ?? "#3b82f6"}
                      onChange={(e) =>
                        updateShapeElement(selectedElementId, () => ({
                          fill: e.target.value,
                        }))
                      }
                      className="h-6 w-8 cursor-pointer"
                    />
                  </label>
                  <label className="text-xs text-stone-600 flex items-center gap-1">
                    Rand
                    <input
                      type="color"
                      value={selectedElement.stroke ?? "#000000"}
                      onChange={(e) =>
                        updateShapeElement(selectedElementId, () => ({
                          stroke: e.target.value,
                        }))
                      }
                      className="h-6 w-8 cursor-pointer"
                    />
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={selectedElement.strokeWidth ?? 0}
                    onChange={(e) =>
                      updateShapeElement(selectedElementId, () => ({
                        strokeWidth: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="text-xs border border-stone-300 rounded px-1 py-0.5 w-14"
                    title="Randstärke (px)"
                  />
                  <button
                    onClick={() => refixElement(selectedElementId)}
                    className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded"
                    title="Form entfernen"
                  >
                    Entfernen
                  </button>
                </>
              ) : selectedElement && isEmojiElement(selectedElement) ? (
                <>
                  <span className="text-xs text-stone-600">
                    Emoji {selectedElement.emoji}
                  </span>
                  <button
                    onClick={() => refixElement(selectedElementId)}
                    className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded"
                    title="Emoji entfernen"
                  >
                    Entfernen
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-stone-600">Bild</span>
                  <input
                    type="text"
                    value={
                      selectedElement && isImageElement(selectedElement)
                        ? (selectedElement.caption?.text ?? "")
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      updateImageElement(selectedElementId, (el) => ({
                        caption:
                          v.trim().length === 0
                            ? undefined
                            : {
                                text: v,
                                position:
                                  el.caption?.position ?? "overlay-bottom",
                                fontSize: el.caption?.fontSize ?? 28,
                                color: el.caption?.color ?? "#000000",
                                align: el.caption?.align ?? "center",
                              },
                      }));
                    }}
                    placeholder="Beschriftung…"
                    className="text-xs border border-stone-300 rounded px-1 py-0.5 w-40"
                  />
                  <button
                    onClick={() =>
                      updateImageElement(selectedElementId, (el) =>
                        el.caption
                          ? {
                              caption: {
                                ...el.caption,
                                position:
                                  el.caption.position === "overlay-top" ||
                                  el.caption.position === "above"
                                    ? "overlay-bottom"
                                    : "overlay-top",
                              },
                            }
                          : {},
                      )
                    }
                    className="text-xs px-2 py-0.5 bg-white border border-stone-300 hover:bg-stone-50 rounded"
                    title="Beschriftung oben/unten"
                  >
                    {selectedElement &&
                    isImageElement(selectedElement) &&
                    (selectedElement.caption?.position === "overlay-top" ||
                      selectedElement.caption?.position === "above")
                      ? "↑ oben"
                      : "↓ unten"}
                  </button>
                  <button
                    onClick={() => refixElement(selectedElementId)}
                    className="text-xs px-2 py-0.5 bg-stone-700 hover:bg-stone-900 text-white rounded"
                  >
                    Fixieren (Lösen rückgängig)
                  </button>
                </>
              )}
              <button
                onClick={() => handleBringToFront(selectedElementId)}
                className="text-xs px-2 py-0.5 bg-white border border-stone-300 hover:bg-stone-50 rounded"
                title="Element nach vorne holen"
              >
                Nach vorne
              </button>
              <button
                onClick={() => handleSendToBack(selectedElementId)}
                className="text-xs px-2 py-0.5 bg-white border border-stone-300 hover:bg-stone-50 rounded"
                title="Element nach hinten schicken"
              >
                Nach hinten
              </button>
              <button
                onClick={() => setSelectedElementId(null)}
                className="text-xs px-2 py-0.5 bg-white border border-stone-300 hover:bg-stone-50 rounded"
              >
                Abwählen
              </button>
            </div>
          )}
          {titlePage && (
            <div id="bookpage-title" className="relative mb-10 scroll-mt-40">
              <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                <span className="px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
                  Titelblatt
                </span>
                {/* Hoch/Quer nur fürs Titelblatt */}
                <div className="flex gap-1">
                  {(
                    [
                      ["portrait", "Hoch"],
                      ["landscape", "Quer"],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() =>
                        setTitlePage((p) =>
                          p ? { ...p, orientation: val } : p,
                        )
                      }
                      className={`text-xs px-2 py-0.5 rounded border ${
                        titleOrientation === val
                          ? "bg-primary-500 text-white border-primary-500"
                          : "bg-white border-stone-300 hover:bg-stone-50"
                      }`}
                      title={`Titelblatt ${label}format`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setTitlePage(null)}
                  className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded"
                  title="Titelblatt entfernen"
                >
                  Entfernen
                </button>
              </div>
              <div
                className="relative shadow-lg mx-auto border border-stone-200"
                style={{
                  width: `${titleDisplayW}px`,
                  height: `${titleDisplayH}px`,
                  ...webPageBackgroundStyle(pageBackground),
                }}
              >
                <textarea
                  value={titlePage.title}
                  onChange={(e) =>
                    setTitlePage((p) => (p ? { ...p, title: e.target.value } : p))
                  }
                  placeholder="Titel"
                  className="absolute resize-none border-0 outline-none bg-transparent text-center overflow-hidden"
                  style={{
                    top: `${titleDisplayH * 0.08}px`,
                    left: "8%",
                    width: "84%",
                    height: `${titleDisplayH * 0.14}px`,
                    fontSize: `${titleDisplayH * 0.06}px`,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    color: titleTextColor,
                    fontFamily: "Roboto",
                  }}
                />
                <div
                  className="absolute flex items-center justify-center overflow-hidden"
                  style={{
                    top: `${titleDisplayH * 0.26}px`,
                    left: "18%",
                    width: "64%",
                    height: `${titleDisplayH * 0.48}px`,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setTitleImageFromFile(f);
                  }}
                >
                  {titlePage.imageSrc ? (
                    <img
                      src={titlePage.imageSrc}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <label className="w-full h-full border-2 border-dashed border-stone-300 rounded flex items-center justify-center text-center px-4 text-sm text-stone-400 cursor-pointer hover:bg-stone-50">
                      Foto wählen oder hierher ziehen
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) setTitleImageFromFile(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                {titlePage.imageSrc && (
                  <label className="absolute bottom-2 right-2 text-xs px-2 py-0.5 bg-white/85 border border-stone-300 rounded cursor-pointer hover:bg-white">
                    Foto ändern
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setTitleImageFromFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                <textarea
                  value={titlePage.subtitle}
                  onChange={(e) =>
                    setTitlePage((p) =>
                      p ? { ...p, subtitle: e.target.value } : p,
                    )
                  }
                  placeholder="Untertitel"
                  className="absolute resize-none border-0 outline-none bg-transparent text-center overflow-hidden"
                  style={{
                    top: `${titleDisplayH * 0.78}px`,
                    left: "12%",
                    width: "76%",
                    height: `${titleDisplayH * 0.1}px`,
                    fontSize: `${titleDisplayH * 0.03}px`,
                    lineHeight: 1.2,
                    color: titleTextColor,
                    fontFamily: "Roboto",
                  }}
                />
              </div>
            </div>
          )}
          {isLocal && pageSequence.length === 0 && (
            <div className="mb-10 flex flex-col items-center">
              <label
                className="relative flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-stone-300 bg-white text-center shadow-sm transition-colors hover:border-primary-400 hover:bg-primary-50/40"
                style={{
                  width: `${toPoints(validPageWidth)}px`,
                  height: `${toPoints(validPageHeight)}px`,
                }}
                title="Fotos hinzufügen"
              >
                <Icon path={mdiImagePlusOutline} size={1.6} color="#d6d3d1" />
                <span className="mt-3 text-sm font-medium text-stone-500">
                  Leere Seite
                </span>
                <span className="mt-1 max-w-[70%] text-xs text-stone-400">
                  Fotos hierher ziehen oder klicken, um Bilder hinzuzufügen
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={isUploadingLocal}
                  onChange={(e) => {
                    if (e.target.files) handleAddLocalPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
          {pageSequence.map((item) => {
            if (item.kind === "blank") return renderBlankPageWeb(item.extra);
            const page = item.page;
            // Scale down to match PDF dimensions (72 DPI from 300 DPI)
            const displayWidth = toPoints(page.width);
            const displayHeight = toPoints(page.height);

            return (
              <div
                key={page.pageNumber}
                id={`bookpage-${page.pageNumber}`}
                // isolate: hält die z-Indizes der Foto-/Overlay-Ebene lokal,
                // damit nichts über die klebende Werkzeugleiste ragt.
                className="relative isolate scroll-mt-40"
              >
                {/* Page number and alignment controls */}
                {combinePages ? (
                  /* Combined pages mode - show controls above each logical page */
                  <div
                    className="mb-2 flex"
                    style={{
                      width: `${displayWidth}px`,
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                    {/* Left page controls */}
                    <div
                      className="flex items-center justify-center gap-2"
                      style={{ width: `${displayWidth / 2}px` }}
                    >
                      <span className="inline-block px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
                        Seite {autoPageStart(page.pageNumber)} von{" "}
                        {bookNumbering.total}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "left");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              "left") === "left"
                              ? "bg-primary-500 text-white border-primary-500"
                              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                          }`}
                          title="Linksbündig"
                        >
                          <Icon path={mdiFormatAlignLeft} size={0.6} />
                        </button>
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "center");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              "left") === "center"
                              ? "bg-primary-500 text-white border-primary-500"
                              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                          }`}
                          title="Zentriert"
                        >
                          <Icon path={mdiFormatAlignCenter} size={0.6} />
                        </button>
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "right");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              "left") === "right"
                              ? "bg-primary-500 text-white border-primary-500"
                              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                          }`}
                          title="Rechtsbündig"
                        >
                          <Icon path={mdiFormatAlignRight} size={0.6} />
                        </button>
                      </div>
                    </div>

                    {/* Right page controls (only if it exists) */}
                    {page.pageNumber * 2 <= totalLogicalPages && (
                      <div
                        className="flex items-center justify-center gap-2"
                        style={{ width: `${displayWidth / 2}px` }}
                      >
                        <span className="inline-block px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
                          Seite {autoPageStart(page.pageNumber) + 1} von{" "}
                          {bookNumbering.total}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "left");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                "left") === "left"
                                ? "bg-primary-500 text-white border-primary-500"
                                : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                            }`}
                            title="Linksbündig"
                          >
                            <Icon path={mdiFormatAlignLeft} size={0.6} />
                          </button>
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "center");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                "left") === "center"
                                ? "bg-primary-500 text-white border-primary-500"
                                : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                            }`}
                            title="Zentriert"
                          >
                            <Icon path={mdiFormatAlignCenter} size={0.6} />
                          </button>
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "right");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                "left") === "right"
                                ? "bg-primary-500 text-white border-primary-500"
                                : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                            }`}
                            title="Rechtsbündig"
                          >
                            <Icon path={mdiFormatAlignRight} size={0.6} />
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => addBlankPage(page.pageNumber)}
                      className="px-2 py-1 text-xs border rounded transition-colors flex items-center bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                      title="Leere Doppelseite nach diesem Spread einfügen"
                    >
                      <Icon path={mdiFilePlusOutline} size={0.6} />
                    </button>
                    <button
                      onClick={() => toggleSpreadMode(page.pageNumber)}
                      className={`px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 ${
                        spreadEffectiveMode(page.pageNumber) === "collage"
                          ? "bg-primary-500 text-white border-primary-500"
                          : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                      }`}
                      title="Diese Doppelseite: Raster oder Collage"
                    >
                      <Icon path={mdiViewGridOutline} size={0.6} />
                      <span className="hidden sm:inline">
                        {spreadEffectiveMode(page.pageNumber) === "collage"
                          ? "Collage"
                          : "Raster"}
                      </span>
                    </button>
                    {spreadEffectiveMode(page.pageNumber) === "collage" ? (
                      <button
                        onClick={() => handleAutoCollagePage(page.photos)}
                        className="px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        title="Auto-Collage: Fotos dieser Doppelseite als Collage anordnen"
                      >
                        <Icon path={mdiViewGridOutline} size={0.6} />
                        <span className="hidden sm:inline">Auto-Collage</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAutoArrangePage(page.photos)}
                        className="px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        title="Auto anordnen: manuelle Größen dieser Doppelseite zurücksetzen (gleichmäßig verteilen)"
                      >
                        <Icon path={mdiViewGridOutline} size={0.6} />
                        <span className="hidden sm:inline">Auto</span>
                      </button>
                    )}
                  </div>
                ) : (
                  /* Single page mode - center everything */
                  <div className="text-center mb-2 flex items-center justify-center gap-2">
                    <span className="inline-block px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
                      Seite {autoPageStart(page.pageNumber)} von {bookNumbering.total}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "left");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) || "left") ===
                          "left"
                            ? "bg-primary-500 text-white border-primary-500"
                            : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        }`}
                        title="Linksbündig"
                      >
                        <Icon path={mdiFormatAlignLeft} size={0.6} />
                      </button>
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "center");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) || "left") ===
                          "center"
                            ? "bg-primary-500 text-white border-primary-500"
                            : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        }`}
                        title="Zentriert"
                      >
                        <Icon path={mdiFormatAlignCenter} size={0.6} />
                      </button>
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "right");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) || "left") ===
                          "right"
                            ? "bg-primary-500 text-white border-primary-500"
                            : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        }`}
                        title="Rechtsbündig"
                      >
                        <Icon path={mdiFormatAlignRight} size={0.6} />
                      </button>
                      <button
                        onClick={() => addBlankPage(page.pageNumber)}
                        className="px-2 py-1 text-xs border rounded transition-colors flex items-center bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        title="Leerseite nach dieser Seite einfügen"
                      >
                        <Icon path={mdiFilePlusOutline} size={0.6} />
                      </button>
                      <button
                        onClick={() => toggleSpreadMode(page.pageNumber)}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 ${
                          spreadEffectiveMode(page.pageNumber) === "collage"
                            ? "bg-primary-500 text-white border-primary-500"
                            : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                        }`}
                        title="Diese Seite: Raster oder Collage"
                      >
                        <Icon path={mdiViewGridOutline} size={0.6} />
                        <span className="hidden sm:inline">
                          {spreadEffectiveMode(page.pageNumber) === "collage"
                            ? "Collage"
                            : "Raster"}
                        </span>
                      </button>
                      {spreadEffectiveMode(page.pageNumber) === "collage" ? (
                        <button
                          onClick={() => handleAutoCollagePage(page.photos)}
                          className="px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                          title="Auto-Collage: Fotos dieser Seite als Collage anordnen"
                        >
                          <Icon path={mdiViewGridOutline} size={0.6} />
                          <span className="hidden sm:inline">Auto-Collage</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAutoArrangePage(page.photos)}
                          className="px-2 py-1 text-xs border rounded transition-colors flex items-center gap-1 bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                          title="Auto anordnen: manuelle Größen dieser Seite zurücksetzen (gleichmäßig verteilen)"
                        >
                          <Icon path={mdiViewGridOutline} size={0.6} />
                          <span className="hidden sm:inline">Auto</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Page container */}
                <div
                  className="relative shadow-lg mx-auto border border-stone-200"
                  style={{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                    ...webPageBackgroundStyle(pageBackground),
                  }}
                >
                  {/* Falz/Bundsteg-Schattierung im Spread (3D-Effekt) */}
                  {combinePages && (
                    <div
                      className="absolute top-0 bottom-0 z-10 pointer-events-none"
                      style={{
                        left: `${displayWidth / 2 - 16}px`,
                        width: "32px",
                        background:
                          "linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.07) 38%, rgba(0,0,0,0.17) 50%, rgba(0,0,0,0.07) 62%, rgba(0,0,0,0) 100%)",
                      }}
                    />
                  )}

                  {/* Photos */}
                  {page.photos.map((photoBox) => {
                    const imageUrl = assetImageUrl(photoBox.asset.id);
                    const isDragging =
                      aspectDragState?.assetId === photoBox.asset.id;

                    // Calculate current aspect ratio
                    const naturalWidth =
                      photoBox.asset.exifInfo?.exifImageWidth || 1;
                    const naturalHeight =
                      photoBox.asset.exifInfo?.exifImageHeight || 1;
                    let currentAspectRatio = naturalWidth / naturalHeight;
                    if (photoBox.asset.exifInfo?.orientation == "6") {
                      currentAspectRatio = naturalHeight / naturalWidth;
                    }
                    // Use custom aspect ratio if set
                    const aspectRatio =
                      customAspectRatios.get(photoBox.asset.id) ||
                      currentAspectRatio;
                    const hasAspectRatioCustomization = customAspectRatios.has(
                      photoBox.asset.id,
                    );
                    const hasDescriptionPositionCustomization =
                      descriptionPositions.has(photoBox.asset.id);
                    const hasCropCustomization = cropPositions.has(
                      photoBox.asset.id,
                    );
                    const isCustomized =
                      hasAspectRatioCustomization ||
                      hasDescriptionPositionCustomization ||
                      hasCropCustomization;
                    const isCropping = croppingAssetId === photoBox.asset.id;

                    // Find global index in filtered assets for drag & drop
                    const globalIndex = filteredAssets.findIndex(
                      (a) => a.id === photoBox.asset.id,
                    );
                    const isBeingDragged =
                      reorderDragState?.draggedAssetId === photoBox.asset.id;
                    const isDropTarget = dropTargetIndex === globalIndex;

                    // Check if this asset has been reordered (compare to default filtered order)
                    const defaultIndex = defaultFilteredAssets.findIndex(
                      (a) => a.id === photoBox.asset.id,
                    );
                    const isReordered =
                      customOrdering !== null && globalIndex !== defaultIndex;

                    const customCaption = imageCaptionTexts.get(
                      photoBox.asset.id,
                    );
                    const isEditingCaption =
                      editingCaptionAssetId === photoBox.asset.id;
                    const descPosition =
                      descriptionPositions.get(photoBox.asset.id) || "bottom";
                    // Eigene Bildunterschrift verdrängt die Immich-Beschreibung.
                    const hasDescription =
                      showDescriptions &&
                      !customCaption &&
                      !!photoBox.asset.exifInfo?.description;
                    const isLeftRight =
                      hasDescription &&
                      (descPosition === "left" || descPosition === "right");

                    // photoBox.width is already doubled by the layout for left/right captions;
                    // the container keeps the full width, the renderer splits image vs. caption.
                    const containerWidth = toPoints(photoBox.width);

                    // Blocker: empty design space (reorder + edge-resize like a photo).
                    if (isBlocker(photoBox.asset.id)) {
                      // Karten-Leerraum: zeigt die GPS-Punkte der Seite.
                      const mapCfg = blockerMaps.get(photoBox.asset.id);
                      if (mapCfg) {
                        const geoPts = geoPointsForPhotos(page.photos);
                        return (
                          <div
                            key={photoBox.asset.id}
                            className={`group absolute ${isBeingDragged ? "opacity-50" : ""}`}
                            style={{
                              left: `${toPoints(photoBox.x)}px`,
                              top: `${toPoints(photoBox.y)}px`,
                              width: `${containerWidth}px`,
                              height: `${toPoints(photoBox.height)}px`,
                            }}
                            onDragOver={(e) =>
                              handleReorderDragOver(globalIndex, e)
                            }
                            onDragEnd={handleReorderDragEnd}
                            onDrop={(e) => handleReorderDrop(globalIndex, e)}
                          >
                            {isDropTarget && reorderDragState && (
                              <div
                                className={`absolute top-0 bottom-0 w-1 bg-green-500 shadow-lg z-40 ${dropAfter ? "right-0" : "left-0"}`}
                              />
                            )}
                            <div className="relative h-full w-full overflow-hidden rounded border border-stone-300 bg-stone-100">
                              {geoPts.length > 0 ? (
                                <MapBlockerView
                                  points={geoPts}
                                  config={mapCfg}
                                  onSave={(cfg) =>
                                    setBlockerMap(photoBox.asset.id, cfg)
                                  }
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-stone-400">
                                  Karte · keine Geodaten auf dieser Seite
                                </div>
                              )}
                              {/* Verschieben-Griff: eigener Handle, da die Karte
                                  selbst Maus-Events fürs Pannen/Zoomen abfängt. */}
                              <button
                                draggable
                                onDragStart={(e) =>
                                  handleReorderDragStart(
                                    photoBox.asset.id,
                                    globalIndex,
                                    e,
                                  )
                                }
                                onDragEnd={handleReorderDragEnd}
                                className="absolute top-1 left-1 z-20 flex cursor-move items-center gap-0.5 rounded bg-stone-800/80 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow transition-opacity hover:bg-stone-900 group-hover:opacity-100"
                                title="Karte verschieben (ziehen zum Umsortieren)"
                                aria-label="Karte verschieben"
                              >
                                <Icon path={mdiCursorMove} size={0.5} />
                                Verschieben
                              </button>
                              <button
                                className="absolute top-1 right-1 z-20 rounded bg-red-500/90 px-2 py-0.5 text-[10px] text-white opacity-0 shadow transition-opacity hover:bg-red-600 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteBlocker(photoBox.asset.id);
                                }}
                                title="Karte entfernen"
                              >
                                Entfernen
                              </button>
                            </div>
                            {/* Kantengriffe zum Skalieren (über der Karte) */}
                            <div
                              className="absolute left-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-transparent transition-colors group-hover:bg-primary-400/50"
                              onMouseDown={(e) =>
                                handleAspectDragStart(
                                  photoBox.asset.id,
                                  "left",
                                  aspectRatio,
                                  photoBox.x,
                                  photoBox.width,
                                  photoBox.height,
                                  e,
                                )
                              }
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-transparent transition-colors group-hover:bg-primary-400/50"
                              onMouseDown={(e) =>
                                handleAspectDragStart(
                                  photoBox.asset.id,
                                  "right",
                                  aspectRatio,
                                  photoBox.x,
                                  photoBox.width,
                                  photoBox.height,
                                  e,
                                )
                              }
                            />
                          </div>
                        );
                      }
                      const isEditingBlocker =
                        editingBlockerId === photoBox.asset.id;
                      const blockerEntry = blockerTexts.get(photoBox.asset.id);
                      const blockerText = blockerEntry?.text ?? "";
                      const blockerTextStyle = {
                        fontFamily: blockerEntry?.fontFamily ?? "Roboto",
                        fontSize: `${blockerEntry?.fontSize ?? 28}px`,
                        color: blockerEntry?.color ?? "#1c1917",
                      };
                      const isDrawing =
                        drawingBlockerId === photoBox.asset.id;
                      const strokes =
                        blockerDrawings.get(photoBox.asset.id) ?? [];
                      const bw = containerWidth;
                      const bh = toPoints(photoBox.height);
                      return (
                        <div
                          key={photoBox.asset.id}
                          className={`absolute group ${isBeingDragged ? "opacity-50" : ""}`}
                          style={{
                            left: `${toPoints(photoBox.x)}px`,
                            top: `${toPoints(photoBox.y)}px`,
                            width: `${containerWidth}px`,
                            height: `${toPoints(photoBox.height)}px`,
                          }}
                          draggable={!isEditingBlocker}
                          onDragStart={(e) =>
                            handleReorderDragStart(
                              photoBox.asset.id,
                              globalIndex,
                              e,
                            )
                          }
                          onDragOver={(e) => handleReorderDragOver(globalIndex, e)}
                          onDragEnd={handleReorderDragEnd}
                          onDrop={(e) => handleReorderDrop(globalIndex, e)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingBlockerId(photoBox.asset.id);
                          }}
                        >
                          {isDropTarget && reorderDragState && (
                            <div
                            className={`absolute top-0 bottom-0 w-1 bg-green-500 shadow-lg z-10 ${dropAfter ? "right-0" : "left-0"}`}
                          />
                          )}
                          <div
                            className={`relative w-full h-full overflow-hidden border-2 border-dashed flex items-center justify-center p-3 text-center ${
                              isDrawing
                                ? "border-primary-500"
                                : isEditingBlocker
                                  ? "border-primary-400"
                                  : "border-stone-300"
                            }`}
                            style={{
                              backgroundColor:
                                blockerEntry?.backgroundColor ?? "#fafaf9",
                            }}
                          >
                            {isEditingBlocker ? (
                              <textarea
                                autoFocus
                                value={blockerText}
                                onChange={(ev) =>
                                  setBlockerText(
                                    photoBox.asset.id,
                                    ev.target.value,
                                  )
                                }
                                onKeyDown={(ev) => {
                                  if (ev.key === "Escape") finishTextEditing();
                                }}
                                onClick={(ev) => ev.stopPropagation()}
                                placeholder="Text eingeben…"
                                className="w-full h-full resize-none border-0 bg-transparent text-center outline-none"
                                style={blockerTextStyle}
                              />
                            ) : blockerText ? (
                              <span
                                className="whitespace-pre-wrap break-words"
                                style={blockerTextStyle}
                              >
                                {blockerText}
                              </span>
                            ) : !isDrawing && strokes.length === 0 ? (
                              <span className="text-xs text-stone-400 select-none">
                                Leerraum · Doppelklick für Text · „Zeichnen"
                              </span>
                            ) : null}

                            {/* Zeichnung (immer sichtbar, nicht interaktiv) */}
                            {strokes.length > 0 && (
                              <svg
                                className="pointer-events-none absolute inset-0"
                                width="100%"
                                height="100%"
                                viewBox={`0 0 ${bw} ${bh}`}
                                preserveAspectRatio="none"
                              >
                                {strokes.map((s, si) => (
                                  <path
                                    key={si}
                                    d={strokeToPath(s.pts, bw, bh)}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth={s.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ))}
                              </svg>
                            )}

                            {/* Interaktive Zeichenfläche (Stift/Touch/Maus) */}
                            {isDrawing && (
                              <svg
                                className="absolute inset-0 z-10"
                                style={{
                                  touchAction: "none",
                                  cursor: "crosshair",
                                }}
                                width="100%"
                                height="100%"
                                viewBox={`0 0 ${bw} ${bh}`}
                                preserveAspectRatio="none"
                                onPointerDown={handleDrawPointerDown}
                                onPointerMove={handleDrawPointerMove}
                                onPointerUp={() =>
                                  handleDrawPointerUp(photoBox.asset.id)
                                }
                                onPointerLeave={() =>
                                  handleDrawPointerUp(photoBox.asset.id)
                                }
                                onClick={(e) => e.stopPropagation()}
                              >
                                {liveStroke && liveStroke.length >= 2 && (
                                  <path
                                    d={strokeToPath(liveStroke, bw, bh)}
                                    fill="none"
                                    stroke={penColor}
                                    strokeWidth={penWidth}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}
                              </svg>
                            )}
                          </div>
                          {/* Zeichnen-Umschalter + Entfernen (nicht während Textbearbeitung) */}
                          {!isEditingBlocker && (
                            <div className="absolute top-1 right-1 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Hintergrund transparent schalten. Der Schalter
                                  lag bisher nur im Textbearbeiten-Werkzeugkasten
                                  und war dadurch praktisch unauffindbar. */}
                              <button
                                className={`text-[10px] px-2 py-0.5 rounded shadow ${
                                  blockerEntry?.backgroundColor === "transparent"
                                    ? "bg-primary-600 text-white hover:bg-primary-700"
                                    : "bg-stone-800/80 text-white hover:bg-stone-900"
                                }`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBlockerTexts((prev) => {
                                    const next = new Map(prev);
                                    const cur = next.get(photoBox.asset.id) ?? { text: "" };
                                    next.set(photoBox.asset.id, {
                                      ...cur,
                                      backgroundColor:
                                        cur.backgroundColor === "transparent"
                                          ? undefined
                                          : "transparent",
                                    });
                                    return next;
                                  });
                                }}
                                title="Hintergrund transparent – die Seitenfarbe scheint durch"
                              >
                                Transparent
                              </button>
                              <button
                                className={`text-[10px] px-2 py-0.5 rounded shadow text-white ${
                                  isDrawing
                                    ? "bg-primary-600 hover:bg-primary-700"
                                    : "bg-stone-800/80 hover:bg-stone-900"
                                }`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDrawingBlockerId(
                                    isDrawing ? null : photoBox.asset.id,
                                  );
                                }}
                                title="Zeichenzone: mit Stift/Finger/Maus zeichnen"
                              >
                                {isDrawing ? "Fertig" : "Zeichnen"}
                              </button>
                              <button
                                className="bg-red-500 hover:bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteBlocker(photoBox.asset.id);
                                }}
                                title="Leerraum entfernen"
                              >
                                Entfernen
                              </button>
                            </div>
                          )}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent group-hover:bg-primary-400/50 transition-colors"
                            onMouseDown={(e) =>
                              handleAspectDragStart(
                                photoBox.asset.id,
                                "left",
                                aspectRatio,
                                photoBox.x,
                                photoBox.width,
                                photoBox.height,
                                e,
                              )
                            }
                          />
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent group-hover:bg-primary-400/50 transition-colors"
                            onMouseDown={(e) =>
                              handleAspectDragStart(
                                photoBox.asset.id,
                                "right",
                                aspectRatio,
                                photoBox.x,
                                photoBox.width,
                                photoBox.height,
                                e,
                              )
                            }
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={photoBox.asset.id}
                        className={`absolute overflow-hidden group cursor-move ${isBeingDragged ? "opacity-50" : ""} ${isLeftRight ? "flex" : ""} ${isCropping ? "ring-2 ring-primary-500 ring-inset" : ""}`}
                        style={{
                          left: `${toPoints(photoBox.x)}px`,
                          top: `${toPoints(photoBox.y)}px`,
                          width: `${containerWidth}px`,
                          height: `${toPoints(photoBox.height)}px`,
                          flexDirection: "row",
                        }}
                        draggable={!isCropping}
                        onDragStart={(e) =>
                          handleReorderDragStart(
                            photoBox.asset.id,
                            globalIndex,
                            e,
                          )
                        }
                        onDragOver={(e) =>
                          handleReorderDragOver(globalIndex, e)
                        }
                        onDragEnd={handleReorderDragEnd}
                        onDrop={(e) => handleReorderDrop(globalIndex, e)}
                      >
                        {/* Drop indicator - shown on left edge when hovering during drag */}
                        {isDropTarget && reorderDragState && (
                          <div
                            className={`absolute top-0 bottom-0 w-1 bg-green-500 shadow-lg z-10 ${dropAfter ? "right-0" : "left-0"}`}
                          />
                        )}

                        <WebElement
                          element={photoBoxToImageElement(photoBox, 0)}
                          ctx={{
                            imageUrl,
                            alt: photoBox.asset.originalFileName,
                            descPosition,
                            description: hasDescription
                              ? photoBox.asset.exifInfo?.description
                              : undefined,
                            dateText: photoDateText(photoBox.asset),
                            imageRotation: rotations.get(photoBox.asset.id),
                            styles: webStyles,
                            onLabelClick: (e) =>
                              handleDescriptionClick(photoBox.asset.id, e),
                            cropPosition: cropPositions.get(photoBox.asset.id),
                          }}
                        />

                        {/* Eigene, gestylte Bildunterschrift (unten am Bild) */}
                        {(customCaption || isEditingCaption) && (
                          <>
                            {isEditingCaption ? (
                              <textarea
                                autoFocus
                                value={customCaption?.text ?? ""}
                                onChange={(ev) =>
                                  setImageCaptionText(
                                    photoBox.asset.id,
                                    ev.target.value,
                                  )
                                }
                                onKeyDown={(ev) => {
                                  if (ev.key === "Escape") finishTextEditing();
                                }}
                                onClick={(ev) => ev.stopPropagation()}
                                placeholder="Bildunterschrift…"
                                className="absolute inset-x-0 bottom-0 z-30 resize-none border-0 px-1 text-center outline-none ring-1 ring-primary-400"
                                style={{
                                  fontSize: `${customCaption?.fontSize ?? fontSize}px`,
                                  height: `${Math.max((customCaption?.fontSize ?? fontSize) * 2.5, 24)}px`,
                                  fontFamily:
                                    customCaption?.fontFamily ?? "Roboto",
                                  color: customCaption?.color ?? "#292524",
                                  backgroundColor:
                                    customCaption?.backgroundColor ??
                                    "rgba(255,255,255,0.85)",
                                }}
                              />
                            ) : (
                              customCaption && (
                                <div
                                  className="absolute inset-x-0 bottom-0 z-20 cursor-text whitespace-pre-wrap break-words px-1 text-center"
                                  style={{
                                    fontSize: `${customCaption.fontSize ?? fontSize}px`,
                                    fontFamily:
                                      customCaption.fontFamily ?? "Roboto",
                                    color: customCaption.color ?? "#292524",
                                    backgroundColor:
                                      customCaption.backgroundColor ??
                                      "rgba(255,255,255,0.7)",
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCaptionAssetId(photoBox.asset.id);
                                  }}
                                >
                                  {customCaption.text}
                                </div>
                              )
                            )}
                          </>
                        )}

                        {/* Crop-Modus: transparentes Drag-Overlay + persistente Steuerung */}
                        {isCropping && (
                          <>
                            <div
                              className="absolute inset-0 z-10 cursor-move"
                              onMouseDown={(e) =>
                                handleCropDragStart(
                                  photoBox.asset.id,
                                  containerWidth,
                                  toPoints(photoBox.height),
                                  e,
                                )
                              }
                            />
                            <div className="absolute top-2 right-2 z-20 flex gap-1">
                              {hasCropCustomization && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleResetCrop(photoBox.asset.id);
                                  }}
                                  className="bg-stone-800/90 hover:bg-stone-900 text-white text-[10px] px-2 py-0.5 rounded shadow"
                                  title="Bildausschnitt zurücksetzen"
                                >
                                  Zurücksetzen
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setCroppingAssetId(null);
                                }}
                                className="bg-primary-600 hover:bg-primary-700 text-white text-[10px] px-2 py-0.5 rounded shadow"
                                title="Fertig"
                              >
                                Fertig
                              </button>
                            </div>
                            {/* Zoom-Regler + Hinweis (zum Verschieben ins Bild ziehen) */}
                            <div
                              className="absolute inset-x-2 bottom-2 z-20 flex items-center gap-2 rounded bg-stone-900/75 px-2 py-1 text-white"
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <span className="text-[10px] whitespace-nowrap">
                                Zoom
                              </span>
                              <input
                                type="range"
                                min={1}
                                max={3}
                                step={0.02}
                                value={
                                  cropPositions.get(photoBox.asset.id)?.scale ??
                                  1
                                }
                                onChange={(e) =>
                                  handleCropZoom(
                                    photoBox.asset.id,
                                    parseFloat(e.target.value),
                                  )
                                }
                                className="h-1 flex-1 cursor-pointer accent-primary-500"
                              />
                              <span className="text-[10px] whitespace-nowrap opacity-80">
                                ziehen zum Verschieben
                              </span>
                            </div>
                          </>
                        )}

                        {/* Reset button - shown on hover for genuinely customized images */}
                        {isCustomized && !isCropping && (
                          <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-primary-500 hover:bg-primary-600 text-white px-3 py-1 rounded shadow-lg text-xs font-medium"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Reset aspect ratio
                              if (hasAspectRatioCustomization) {
                                setCustomAspectRatios((prev) => {
                                  const next = new Map(prev);
                                  next.delete(photoBox.asset.id);
                                  return next;
                                });
                              }
                              // Reset description position
                              if (hasDescriptionPositionCustomization) {
                                setDescriptionPositions((prev) => {
                                  const next = new Map(prev);
                                  next.delete(photoBox.asset.id);
                                  return next;
                                });
                              }
                              // Reset crop (object-position)
                              if (hasCropCustomization) {
                                handleResetCrop(photoBox.asset.id);
                              }
                              // Reset custom ordering by rebuilding the array without this asset
                              // This moves the asset back to its default position
                              if (isReordered && customOrdering) {
                                const assetId = photoBox.asset.id;
                                const defaultIndex = defaultFilteredAssets.findIndex(
                                  (a) => a.id === assetId,
                                );

                                // Remove asset from custom ordering
                                const newOrdering = customOrdering.filter(
                                  (id) => id !== assetId,
                                );

                                // Insert it back at its default position
                                newOrdering.splice(defaultIndex, 0, assetId);

                                setCustomOrdering(newOrdering);
                              }
                            }}
                            title="Reset all customizations"
                          >
                            Reset
                          </div>
                        )}

                        {/* Kompakte Foto-Werkzeugleiste (Icons). Bricht bei
                            schmalen Bildern um, statt abgeschnitten zu werden. */}
                        {!isCropping && (
                          <div className="absolute top-2 right-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-0.5 rounded-lg bg-stone-900/75 p-0.5 opacity-0 shadow backdrop-blur transition-opacity group-hover:opacity-100">
                            {spreadEffectiveMode(page.pageNumber) ===
                              "collage" && (
                              <button
                                className={`rounded px-1.5 py-1 text-sm leading-none text-white transition-colors hover:bg-white/20 ${
                                  (heightFactors.get(photoBox.asset.id) ?? 1) >= 2
                                    ? "bg-primary-500"
                                    : ""
                                }`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleHeightFactor(photoBox.asset.id);
                                }}
                                title="Hohe Kachel (über mehrere Zeilen) an/aus"
                                aria-label="Höhe umschalten"
                              >
                                ↕
                              </button>
                            )}
                            <button
                              className={`rounded p-1 text-white transition-colors hover:bg-white/20 ${
                                imageAlignments.has(photoBox.asset.id)
                                  ? "bg-primary-500"
                                  : ""
                              }`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                cycleImageAlignment(photoBox.asset.id);
                              }}
                              title={`Ausrichtung in der Zeile: ${
                                imageAlignments.get(photoBox.asset.id) ??
                                "Seiten-Standard"
                              } — klicken zum Wechseln (wirkt nur bei freiem Platz in der Zeile)`}
                              aria-label="Ausrichtung in der Zeile"
                            >
                              <Icon
                                path={
                                  imageAlignments.get(photoBox.asset.id) ===
                                  "center"
                                    ? mdiFormatAlignCenter
                                    : imageAlignments.get(
                                          photoBox.asset.id,
                                        ) === "right"
                                      ? mdiFormatAlignRight
                                      : mdiFormatAlignLeft
                                }
                                size={0.7}
                              />
                            </button>
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-white/20"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCroppingAssetId(photoBox.asset.id);
                              }}
                              title="Bildausschnitt anpassen (Crop)"
                              aria-label="Zuschneiden"
                            >
                              <Icon path={mdiCropRotate} size={0.7} />
                            </button>
                            <button
                              className={`rounded p-1 text-white transition-colors hover:bg-white/20 ${
                                (rotations.get(photoBox.asset.id) ?? 0) !== 0
                                  ? "bg-primary-500"
                                  : ""
                              }`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                rotatePhoto(photoBox.asset.id);
                              }}
                              title={`Um 90° drehen (aktuell ${
                                rotations.get(photoBox.asset.id) ?? 0
                              }°) — das Seitenverhältnis dreht sich mit`}
                              aria-label="Um 90 Grad drehen"
                            >
                              <Icon path={mdiRotateRight} size={0.7} />
                            </button>
                            <button
                              className={`rounded p-1 text-white transition-colors hover:bg-white/20 ${
                                isDateVisible(photoBox.asset.id)
                                  ? "bg-primary-500"
                                  : ""
                              }`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                togglePhotoDate(photoBox.asset.id);
                              }}
                              disabled={!photoBox.asset.fileCreatedAt}
                              title={
                                photoBox.asset.fileCreatedAt
                                  ? `Aufnahmedatum ${
                                      isDateVisible(photoBox.asset.id)
                                        ? "ausblenden"
                                        : "einblenden"
                                    } — ${new Date(
                                      photoBox.asset.fileCreatedAt,
                                    ).toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "long",
                                      day: "numeric",
                                    })}`
                                  : "Kein Aufnahmedatum vorhanden"
                              }
                              aria-label="Aufnahmedatum ein-/ausblenden"
                            >
                              <Icon path={mdiCalendarOutline} size={0.7} />
                            </button>
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-white/20"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!imageCaptionTexts.has(photoBox.asset.id)) {
                                  setImageCaptionTexts((prev) =>
                                    new Map(prev).set(photoBox.asset.id, {
                                      text: "",
                                    }),
                                  );
                                }
                                setEditingCaptionAssetId(photoBox.asset.id);
                              }}
                              title="Bildunterschrift hinzufügen/bearbeiten"
                              aria-label="Bildunterschrift"
                            >
                              <Icon path={mdiFormatText} size={0.7} />
                            </button>
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-white/20"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const pageId = String(page.pageNumber);
                                const newEl = createImageElement(
                                  photoBox.asset.id,
                                  {
                                    x: photoBox.x,
                                    y: photoBox.y,
                                    width: photoBox.width,
                                    height: photoBox.height,
                                  },
                                );
                                setOverlayElements((prev) => ({
                                  ...prev,
                                  [pageId]: [...(prev[pageId] ?? []), newEl],
                                }));
                              }}
                              title="Aus dem Auto-Layout lösen (frei platzierbar)"
                              aria-label="Lösen"
                            >
                              <Icon path={mdiImageEditOutline} size={0.7} />
                            </button>
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-white/20"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleAddBlocker(photoBox.asset.id);
                              }}
                              title="Leerraum nach diesem Foto einfügen"
                              aria-label="Leerraum einfügen"
                            >
                              <Icon path={mdiVectorRectangle} size={0.7} />
                            </button>
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-white/20"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleAddMap(photoBox.asset.id);
                              }}
                              title="Karte nach diesem Foto einfügen"
                              aria-label="Karte einfügen"
                            >
                              <Icon path={mdiMapMarkerOutline} size={0.7} />
                            </button>
                            <span className="mx-0.5 h-4 w-px bg-white/25" />
                            <button
                              className="rounded p-1 text-white transition-colors hover:bg-red-500/80"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleExcludeAsset(photoBox.asset.id);
                              }}
                              title="Aus dem Fotobuch entfernen (bleibt in Immich)"
                              aria-label="Entfernen"
                            >
                              <Icon path={mdiTrashCanOutline} size={0.7} />
                            </button>
                          </div>
                        )}

                        {/* Left drag handle */}
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize transition-colors ${
                            isDragging && aspectDragState.edge === "left"
                              ? "bg-primary-500"
                              : "bg-transparent group-hover:bg-primary-400/50"
                          }`}
                          onMouseDown={(e) =>
                            handleAspectDragStart(
                              photoBox.asset.id,
                              "left",
                              aspectRatio,
                              photoBox.x,
                              photoBox.width,
                              photoBox.height,
                              e,
                            )
                          }
                        />

                        {/* Right drag handle */}
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize transition-colors ${
                            isDragging && aspectDragState.edge === "right"
                              ? "bg-primary-500"
                              : "bg-transparent group-hover:bg-primary-400/50"
                          }`}
                          onMouseDown={(e) =>
                            handleAspectDragStart(
                              photoBox.asset.id,
                              "right",
                              aspectRatio,
                              photoBox.x,
                              photoBox.width,
                              photoBox.height,
                              e,
                            )
                          }
                        />

                      </div>
                    );
                  })}

                  {/* Freie Elemente über dem Auto-Layout (gemeinsame Overlay-Ebene). */}
                  {renderOverlay(String(page.pageNumber))}
                </div>
              </div>
            );
          })}

          {moveableTarget &&
            createPortal(
              <Moveable
              target={moveableTarget}
              draggable
              resizable
              rotatable
              snappable
              snapThreshold={8}
              snapDirections={{
                top: true,
                left: true,
                bottom: true,
                right: true,
                center: true,
                middle: true,
              }}
              elementSnapDirections={{
                top: true,
                left: true,
                bottom: true,
                right: true,
                center: true,
                middle: true,
              }}
              elementGuidelines={snapElementGuidelines}
              origin={false}
              throttleDrag={0}
              throttleResize={0}
              throttleRotate={0}
              onDrag={(e) => {
                if (!selectedElementId) return;
                updateOverlayElement(selectedElementId, (el) => ({
                  x: el.x + screenToLayoutPx(e.delta[0]),
                  y: el.y + screenToLayoutPx(e.delta[1]),
                }));
              }}
              onResize={(e) => {
                if (!selectedElementId) return;
                updateOverlayElement(selectedElementId, (el) => {
                  const dw = screenToLayoutPx(e.delta[0]);
                  const dh = screenToLayoutPx(e.delta[1]);
                  return {
                    width: Math.max(40, el.width + dw),
                    height: Math.max(40, el.height + dh),
                    x: e.direction[0] === -1 ? el.x - dw : el.x,
                    y: e.direction[1] === -1 ? el.y - dh : el.y,
                  };
                });
              }}
              onRotate={(e) => {
                if (!selectedElementId) return;
                updateOverlayElement(selectedElementId, (el) => ({
                  rotation: el.rotation + e.delta,
                }));
              }}
            />,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}

export default PhotoGrid;
