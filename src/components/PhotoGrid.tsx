import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  getAlbumInfo,
  type AlbumResponseDto,
  type AssetResponseDto,
} from "@immich/sdk";
import {
  PDFViewer,
  Document,
  Page,
  View,
  StyleSheet,
  Font,
  Svg,
  Defs,
  LinearGradient,
  Stop,
  Rect,
} from "@react-pdf/renderer";
import {
  calculatePageLayout,
  PAGE_SIZES,
  type PageAlignment,
} from "../utils/pageLayout";
import {
  loadAlbumConfig,
  saveAlbumConfig,
  type Position,
  type AlbumConfig,
  type PageBackground,
} from "../utils/albumConfig";
import { toPoints, screenToLayoutPx } from "../utils/units";
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
import Icon from "@mdi/react";
import {
  mdiFormatAlignLeft,
  mdiFormatAlignCenter,
  mdiFormatAlignRight,
  mdiTrashCanOutline,
} from "@mdi/js";

// Register Roboto font for PDF using local bundled files
Font.register({
  family: "Roboto",
  fonts: [
    { src: roboto400, fontWeight: 400 },
    { src: roboto500, fontWeight: 500 },
  ],
});

// Farb-Emoji im PDF über lokal gebündelte Twemoji-PNGs (offline, kein CDN zur Laufzeit).
Font.registerEmojiSource({ format: "png", url: "/twemoji/" });

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

  // Create dynamic styles based on current fontSize
  const pdfStyles = useMemo(() => createDynamicStyles(fontSize), [fontSize]);
  const webStyles = useMemo(() => createWebStyles(fontSize), [fontSize]);

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

  // Drag state for reordering
  const [reorderDragState, setReorderDragState] = useState<{
    draggedAssetId: string;
    draggedIndex: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Drag state for aspect ratio adjustment
  const [aspectDragState, setAspectDragState] = useState<{
    assetId: string;
    edge: "left" | "right";
    startX: number;
    originalAspectRatio: number;
    originalX: number;
    originalWidth: number;
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [widthCmInput, setWidthCmInput] = useState(
    String(pxToCm(initialConfig.pageWidth)),
  );
  const [heightCmInput, setHeightCmInput] = useState(
    String(pxToCm(initialConfig.pageHeight)),
  );

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
      customAspectRatios: Object.fromEntries(customAspectRatios),
      customOrdering,
      descriptionPositions: Object.fromEntries(descriptionPositions),
      pageAlignments: Object.fromEntries(pageAlignments),
      excludedAssetIds: Array.from(excludedAssetIds),
    };
    saveAlbumConfig(album.id, { ...config, overlayElements });
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
    customAspectRatios,
    customOrdering,
    descriptionPositions,
    pageAlignments,
    overlayElements,
    excludedAssetIds,
    isPageWidthValid,
    isPageHeightValid,
    isMarginValid,
    isRowHeightValid,
    isSpacingValid,
  ]);

  const loadAlbumAssets = async () => {
    try {
      setIsLoading(true);
      setError(null);
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

  // Handle aspect ratio drag start
  const handleAspectDragStart = (
    assetId: string,
    edge: "left" | "right",
    aspectRatio: number,
    x: number,
    width: number,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setAspectDragState({
      assetId,
      edge,
      startX: event.clientX,
      originalAspectRatio: aspectRatio,
      originalX: x,
      originalWidth: width,
    });
  };

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

  const handleReorderDragOver = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  };

  const handleReorderDragEnd = () => {
    setReorderDragState(null);
    setDropTargetIndex(null);
  };

  const handleReorderDrop = (targetIndex: number, event: React.DragEvent) => {
    event.preventDefault();

    if (!reorderDragState) return;

    const { draggedIndex } = reorderDragState;

    if (draggedIndex === targetIndex) {
      handleReorderDragEnd();
      return;
    }

    // Create new ordering based on current filtered assets
    const currentOrder = filteredAssets.map((asset) => asset.id);
    const newOrder = [...currentOrder];

    // Remove from old position
    const [removed] = newOrder.splice(draggedIndex, 1);
    // Insert at new position
    newOrder.splice(targetIndex, 0, removed);

    setCustomOrdering(newOrder);
    handleReorderDragEnd();
  };

  // Reset ordering to default
  const handleResetOrdering = () => {
    setCustomOrdering(null);
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
  const handleAddBlocker = () => {
    const id = `${BLOCKER_PREFIX}${crypto.randomUUID()}`;
    setCustomAspectRatios((prev) => new Map(prev).set(id, 1));
    setCustomOrdering((prev) => [
      ...(prev ?? defaultFilteredAssets.map((a) => a.id)),
      id,
    ]);
  };
  const handleDeleteBlocker = (id: string) => {
    setCustomOrdering((prev) => (prev ? prev.filter((x) => x !== id) : prev));
    setCustomAspectRatios((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  // Phase 4: place an album image as a free element (centered on page 1, then movable).
  const handleInsertImage = (asset: AssetResponseDto) => {
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
      ["1"]: [...(prev["1"] ?? []), el],
    }));
    setSelectedElementId(el.id);
    setShowImagePicker(false);
  };

  // Externe Bilddateien (Upload oder Drag & Drop) als freie Bild-Elemente einfügen.
  const handleInsertImageFiles = async (files: FileList | File[]) => {
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
      const el = createImageElement(crypto.randomUUID(), {
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
        ["1"]: [...(prev["1"] ?? []), el],
      }));
      setSelectedElementId(el.id);
    }
    setShowImagePicker(false);
  };

  // Phase 5: place a free text field (centered on page 1, then editable/movable).
  const handleInsertText = () => {
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
      ["1"]: [...(prev["1"] ?? []), el],
    }));
    setSelectedElementId(el.id);
  };

  const handleInsertShape = () => {
    const size = 600;
    const el = createShapeElement({
      x: Math.round((validPageWidth - size) / 2),
      y: Math.round((validPageHeight - size) / 2),
      width: size,
      height: size,
    });
    setOverlayElements((prev) => ({
      ...prev,
      ["1"]: [...(prev["1"] ?? []), el],
    }));
    setSelectedElementId(el.id);
  };

  const handleInsertEmoji = (emoji: string) => {
    const size = 400;
    const el = createEmojiElement(emoji, {
      x: Math.round((validPageWidth - size) / 2),
      y: Math.round((validPageHeight - size) / 2),
      width: size,
      height: size,
    });
    setOverlayElements((prev) => ({
      ...prev,
      ["1"]: [...(prev["1"] ?? []), el],
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

    return calculatePageLayout(layoutAssets, {
      pageSize: "CUSTOM",
      orientation: "portrait",
      margin: validMargin,
      rowHeight: validRowHeight,
      spacing: validSpacing,
      customWidth: validPageWidth,
      customHeight: validPageHeight,
      combinePages,
      customAspectRatios: adjustedAspectRatios,
      pageAlignments,
    });
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
  ]);

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
  const refixElement = (id: string) => {
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

  // Determine pageLayout based on combinePages setting
  const pageLayout = combinePages ? "singlePage" : "twoPageLeft";

  // Calculate total logical pages for display purposes
  const totalLogicalPages = combinePages ? pages.length * 2 : pages.length;

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900"></div>
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
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        if (mode !== "preview") return;
        e.preventDefault();
        setIsDraggingFile(false);
        if (e.dataTransfer.files?.length) {
          handleInsertImageFiles(e.dataTransfer.files);
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
      {/* Controls */}
      <div className="mb-6 flex flex-col lg:flex-row flex-1 items-start lg:justify-between gap-4 lg:gap-8">
        <div className="w-full lg:w-auto">
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

          {/* Generate PDF / Back to Edit button */}
          <div className="mt-4 flex flex-wrap gap-2">
            {mode === "preview" ? (
              <button
                onClick={() => setMode("pdf")}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors shadow-sm"
              >
                PDF erzeugen
              </button>
            ) : (
              <button
                onClick={() => setMode("preview")}
                className="px-6 py-2 bg-stone-600 text-white rounded-lg hover:bg-stone-700 font-medium transition-colors shadow-sm"
              >
                Zurück zum Editor
              </button>
            )}
            {mode === "preview" && (
              <button
                onClick={handleAddBlocker}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm"
                title="Leeren Gestaltungsraum einfügen (drückt Bilder weg)"
              >
                + Leerraum
              </button>
            )}
            {mode === "preview" && (
              <button
                onClick={() => setShowImagePicker((v) => !v)}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm"
                title="Ein Album-Bild frei auf der Seite platzieren"
              >
                + Bild einfügen
              </button>
            )}
            {mode === "preview" && (
              <button
                onClick={handleInsertText}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm"
                title="Freies Textfeld einfügen"
              >
                + Text einfügen
              </button>
            )}
            {mode === "preview" && (
              <button
                onClick={handleInsertShape}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm"
                title="Freie Form einfügen (Rechteck/Ellipse/Linie)"
              >
                + Form
              </button>
            )}
            {mode === "preview" && (
              <div className="relative">
                <button
                  onClick={() => setEmojiPickerOpen((v) => !v)}
                  className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm"
                  title="Emoji einfügen"
                >
                  + Emoji
                </button>
                {emojiPickerOpen && (
                  <div className="absolute z-50 mt-1 w-80 rounded-lg border border-stone-300 bg-white p-3 shadow-xl">
                    <p className="mb-2 text-xs font-medium text-stone-500">
                      Emoji wählen
                    </p>
                    <div className="grid grid-cols-7 gap-1.5">
                      {EMOJI_PALETTE.map((em) => (
                        <button
                          key={em}
                          onClick={() => handleInsertEmoji(em)}
                          className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100 text-2xl leading-none transition-colors"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {excludedAssetIds.size > 0 && (
              <button
                onClick={() => setShowExcludedPanel((v) => !v)}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 font-medium transition-colors shadow-sm text-sm flex items-center gap-1.5"
                title="Aus dem Buch entfernte Bilder anzeigen / wiederherstellen"
              >
                <Icon path={mdiTrashCanOutline} size={0.7} />
                {excludedAssetIds.size}
              </button>
            )}
          </div>
        </div>

        <div className="w-full lg:w-auto">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${
                settingsOpen ? "rotate-90" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Einstellungen
          </button>
          {settingsOpen && (
            <div className="space-y-2 mt-2">
              {/* 1. Page Setup */}
          <div className="p-2 bg-stone-50 rounded border border-stone-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-stone-700 sm:w-28">
                Seite (cm)
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="pageWidth" className="text-stone-600 text-xs">
                    Breite:
                  </label>
                  <input
                    type="number"
                    id="pageWidth"
                    value={widthCmInput}
                    onChange={(e) => {
                      setWidthCmInput(e.target.value);
                      const cm = Number(e.target.value);
                      if (!isNaN(cm) && cm > 0) {
                        setPageWidth(cmToPx(cm));
                      }
                    }}
                    min="8"
                    max="85"
                    step="0.1"
                    className={`px-1 py-0.5 w-16 text-xs border rounded ${
                      isPageWidthValid
                        ? "border-stone-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="pageHeight" className="text-stone-600 text-xs">
                    Höhe:
                  </label>
                  <input
                    type="number"
                    id="pageHeight"
                    value={heightCmInput}
                    onChange={(e) => {
                      setHeightCmInput(e.target.value);
                      const cm = Number(e.target.value);
                      if (!isNaN(cm) && cm > 0) {
                        setPageHeight(cmToPx(cm));
                      }
                    }}
                    min="8"
                    max="85"
                    step="0.1"
                    className={`px-1 py-0.5 w-16 text-xs border rounded ${
                      isPageHeightValid
                        ? "border-stone-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                </div>
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
                    if (e.target.files) handleInsertImageFiles(e.target.files);
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
                    src={`${immichConfig.baseUrl}/assets/${asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`}
                    alt={asset.originalFileName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
          </div>
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
                      src={`${immichConfig.baseUrl}/assets/${asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`}
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
              {pages.map((pageData) => {
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
                      // Blockers reserve empty space in the PDF (nothing drawn).
                      if (isBlocker(photoBox.asset.id)) return null;
                      const imageUrl = `${immichConfig.baseUrl}/assets/${photoBox.asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`;
                      const descPosition =
                        descriptionPositions.get(photoBox.asset.id) || "bottom";
                      const hasDescription =
                        showDescriptions &&
                        !!photoBox.asset.exifInfo?.description;
                      return (
                        <PdfElement
                          key={photoBox.asset.id}
                          element={photoBoxToImageElement(photoBox, 0)}
                          ctx={{
                            imageUrl,
                            descPosition,
                            description: hasDescription
                              ? photoBox.asset.exifInfo?.description
                              : undefined,
                            dateText:
                              showDates && photoBox.asset.fileCreatedAt
                                ? new Date(
                                    photoBox.asset.fileCreatedAt,
                                  ).toLocaleDateString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  })
                                : undefined,
                            styles: pdfStyles,
                          }}
                        />
                      );
                    })}
                    {(overlayElements[String(pageData.pageNumber)] ?? []).map(
                      (el) =>
                        isImageElement(el) ? (
                          <PdfElement
                            key={el.id}
                            element={el}
                            ctx={{
                              imageUrl:
                                el.src ??
                                `${immichConfig.baseUrl}/assets/${el.assetId}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`,
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
                    )}
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
          onClick={() => setSelectedElementId(null)}
        >
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
          {pages.map((page) => {
            // Scale down to match PDF dimensions (72 DPI from 300 DPI)
            const displayWidth = toPoints(page.width);
            const displayHeight = toPoints(page.height);

            return (
              <div key={page.pageNumber} className="relative">
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
                        Seite {page.pageNumber * 2 - 1} von {totalLogicalPages}
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
                          Seite {page.pageNumber * 2} von {totalLogicalPages}
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
                  </div>
                ) : (
                  /* Single page mode - center everything */
                  <div className="text-center mb-2 flex items-center justify-center gap-2">
                    <span className="inline-block px-3 py-1 bg-stone-100 text-stone-600 text-sm rounded">
                      Page {page.pageNumber} of {totalLogicalPages}
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
                    const imageUrl = `${immichConfig.baseUrl}/assets/${photoBox.asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`;
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
                    const isCustomized =
                      hasAspectRatioCustomization ||
                      hasDescriptionPositionCustomization;

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

                    const descPosition =
                      descriptionPositions.get(photoBox.asset.id) || "bottom";
                    const hasDescription =
                      showDescriptions &&
                      !!photoBox.asset.exifInfo?.description;
                    const isLeftRight =
                      hasDescription &&
                      (descPosition === "left" || descPosition === "right");

                    // photoBox.width is already doubled by the layout for left/right captions;
                    // the container keeps the full width, the renderer splits image vs. caption.
                    const containerWidth = toPoints(photoBox.width);

                    // Blocker: empty design space (reorder + edge-resize like a photo).
                    if (isBlocker(photoBox.asset.id)) {
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
                          draggable
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
                        >
                          {isDropTarget && reorderDragState && (
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-lg z-10" />
                          )}
                          <div className="w-full h-full border-2 border-dashed border-stone-300 bg-stone-50 flex items-center justify-center text-stone-400 text-xs select-none">
                            Leerraum
                          </div>
                          <button
                            className="absolute top-1 right-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white text-[10px] px-2 py-0.5 rounded shadow"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteBlocker(photoBox.asset.id);
                            }}
                            title="Leerraum entfernen"
                          >
                            Entfernen
                          </button>
                          <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent group-hover:bg-primary-400/50 transition-colors"
                            onMouseDown={(e) =>
                              handleAspectDragStart(
                                photoBox.asset.id,
                                "left",
                                aspectRatio,
                                photoBox.x,
                                photoBox.width,
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
                        className={`absolute overflow-hidden group cursor-move ${isBeingDragged ? "opacity-50" : ""} ${isLeftRight ? "flex" : ""}`}
                        style={{
                          left: `${toPoints(photoBox.x)}px`,
                          top: `${toPoints(photoBox.y)}px`,
                          width: `${containerWidth}px`,
                          height: `${toPoints(photoBox.height)}px`,
                          flexDirection: "row",
                        }}
                        draggable
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
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-lg z-10" />
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
                            dateText:
                              showDates && photoBox.asset.fileCreatedAt
                                ? new Date(
                                    photoBox.asset.fileCreatedAt,
                                  ).toLocaleDateString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  })
                                : undefined,
                            styles: webStyles,
                            onLabelClick: (e) =>
                              handleDescriptionClick(photoBox.asset.id, e),
                          }}
                        />

                        {/* Customization indicators */}
                        {hasAspectRatioCustomization && (
                          <div
                            className="absolute top-2 left-2 w-2 h-2 bg-primary-500 rounded-full shadow-lg"
                            title="Aspect ratio customized"
                          />
                        )}
                        {hasDescriptionPositionCustomization && (
                          <div
                            className="absolute top-2 left-5 w-2 h-2 bg-purple-500 rounded-full shadow-lg"
                            title="Label position customized"
                          />
                        )}
                        {isReordered && (
                          <div
                            className="absolute top-2 left-8 w-2 h-2 bg-green-500 rounded-full shadow-lg"
                            title="Image reordered"
                          />
                        )}

                        {/* Reset button - shown on hover for customized images */}
                        {(isCustomized || isReordered) && (
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

                        {/* Phase 3: unlock this auto image into a free element */}
                        <button
                          className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-stone-800/80 hover:bg-stone-900 text-white text-[10px] px-2 py-0.5 rounded shadow"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const pageId = String(page.pageNumber);
                            const newEl = createImageElement(photoBox.asset.id, {
                              x: photoBox.x,
                              y: photoBox.y,
                              width: photoBox.width,
                              height: photoBox.height,
                            });
                            setOverlayElements((prev) => ({
                              ...prev,
                              [pageId]: [...(prev[pageId] ?? []), newEl],
                            }));
                          }}
                          title="Aus dem Auto-Layout lösen (frei platzierbar)"
                        >
                          Lösen
                        </button>

                        {/* Aus dem Buch entfernen (bleibt in Immich) */}
                        <button
                          className="absolute bottom-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600/90 hover:bg-red-700 text-white text-[10px] px-2 py-0.5 rounded shadow"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleExcludeAsset(photoBox.asset.id);
                          }}
                          title="Aus dem Fotobuch entfernen (bleibt in Immich)"
                        >
                          Entfernen
                        </button>

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
                              e,
                            )
                          }
                        />
                      </div>
                    );
                  })}

                  {/* Phase 3: free overlay elements, rendered above the auto layout */}
                  {(overlayElements[String(page.pageNumber)] ?? []).map((el) => (
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
                                `${immichConfig.baseUrl}/assets/${el.assetId}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`,
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
                                updateTextElement(el.id, () => ({
                                  text: ev.target.value,
                                }))
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
                    ))}
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
