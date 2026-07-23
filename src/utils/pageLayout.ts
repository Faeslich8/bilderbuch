import { JustifiedLayout } from "@immich/justified-layout-wasm";
import type { AssetResponseDto } from "@immich/sdk";

export interface PageSize {
  width: number; // in pixels
  height: number; // in pixels
  name: "A4" | "LETTER" | "A3";
}

export interface PhotoBox {
  asset: AssetResponseDto;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PageAlignment = "left" | "center" | "right";

export interface Page {
  pageNumber: number;
  photos: PhotoBox[];
  width: number;
  height: number;
}

// Convert millimeters to pixels (assuming 300 DPI)
// 1 inch = 25.4 mm = 300 pixels
// 1 mm = 300/25.4 = 11.811023622047244 pixels
export function mmToPixels(mm: number): number {
  return Math.round(mm * 11.811023622047244);
}

// Page sizes in pixels (at 300 DPI)
export const PAGE_SIZES: Record<string, Record<string, PageSize>> = {
  A4: {
    portrait: { width: mmToPixels(210), height: mmToPixels(297), name: "A4" }, // 210mm x 297mm
    landscape: { width: mmToPixels(297), height: mmToPixels(210), name: "A4" },
  },
  LETTER: {
    portrait: {
      width: mmToPixels(215.9),
      height: mmToPixels(279.4),
      name: "LETTER",
    }, // 8.5" x 11"
    landscape: {
      width: mmToPixels(279.4),
      height: mmToPixels(215.9),
      name: "LETTER",
    },
  },
  A3: {
    portrait: { width: mmToPixels(297), height: mmToPixels(420), name: "A3" }, // 297mm x 420mm
    landscape: { width: mmToPixels(420), height: mmToPixels(297), name: "A3" },
  },
};

export interface LayoutOptions {
  pageSize: "A4" | "LETTER" | "A3" | "CUSTOM";
  orientation: "portrait" | "landscape";
  margin: number; // in pixels
  rowHeight: number; // in pixels
  spacing: number; // in pixels
  customWidth?: number; // in pixels
  customHeight?: number; // in pixels
  combinePages?: boolean; // combine two pages into one PDF page
  customAspectRatios?: Map<string, number>; // custom aspect ratios per asset ID
  pageAlignments?: Map<number, PageAlignment>; // alignment per page number
  heightFactors?: Map<string, number>; // Collage: Höhenfaktor je Asset (>=2 = hohe Kachel)
  imageAlignments?: Map<string, PageAlignment>; // Ausrichtung einzelner Fotos in ihrer Zeile
  layoutMode?: "justified" | "collage"; // Standard-Modus (für die Per-Seite-Engine)
  pageLayoutModes?: Map<number, "justified" | "collage">; // Modus je logischer Seite
}

/**
 * Calculate page-based layout for photos
 * This is the single source of truth for layout - used by both web and PDF
 */
export function calculatePageLayout(
  assets: AssetResponseDto[],
  options: LayoutOptions,
): Page[] {
  if (assets.length === 0) return [];

  const {
    pageSize,
    orientation,
    margin,
    rowHeight,
    spacing,
    customWidth,
    customHeight,
    customAspectRatios,
    pageAlignments,
    imageAlignments,
  } = options;

  // Determine page dimensions in pixels
  let pageDimensions: { width: number; height: number };
  if (pageSize === "CUSTOM" && customWidth && customHeight) {
    pageDimensions = {
      width: customWidth,
      height: customHeight,
    };
  } else if (pageSize !== "CUSTOM") {
    pageDimensions = PAGE_SIZES[pageSize][orientation];
  } else {
    // Fallback to A4 portrait if custom selected but no dimensions provided
    pageDimensions = PAGE_SIZES.A4.portrait;
  }

  const contentWidth = pageDimensions.width - margin * 2;
  const contentHeight = pageDimensions.height - margin * 2;

  // Calculate aspect ratios for justified layout
  const aspectRatios = new Float32Array(
    assets.map((asset) => {
      // Check if there's a custom aspect ratio for this asset
      const customRatio = customAspectRatios?.get(asset.id);
      if (customRatio) {
        return customRatio;
      }

      // Otherwise use the asset's natural aspect ratio
      const width = asset.exifInfo?.exifImageWidth || 1;
      const height = asset.exifInfo?.exifImageHeight || 1;
      if (asset.exifInfo?.orientation == "6") {
        return height / width;
      }
      return width / height;
    }),
  );

  // Run justified layout algorithm
  const justifiedLayout = new JustifiedLayout(aspectRatios, {
    rowHeight,
    rowWidth: contentWidth,
    spacing,
    heightTolerance: 0,
  });

  // Convert justified layout positions to page-based layout
  const pages: Page[] = [];
  let currentPage: Page = {
    pageNumber: 1,
    photos: [],
    width: pageDimensions.width,
    height: pageDimensions.height,
  };
  let currentPageY = 0;

  for (let i = 0; i < assets.length; i++) {
    const box = justifiedLayout.getPosition(i);
    const asset = assets[i];

    // Check if photo fits on current page
    const photoBottom = box.top + box.height;

    if (
      currentPage.photos.length > 0 &&
      photoBottom - currentPageY > contentHeight
    ) {
      // Start a new page
      pages.push(currentPage);
      currentPage = {
        pageNumber: pages.length + 1,
        photos: [],
        width: pageDimensions.width,
        height: pageDimensions.height,
      };
      currentPageY = box.top;
    }

    // Add photo to current page (adjust Y relative to page)
    currentPage.photos.push({
      asset,
      x: box.left + margin,
      y: box.top - currentPageY + margin,
      width: box.width,
      height: box.height,
    });
  }

  // Add the last page
  if (currentPage.photos.length > 0) {
    pages.push(currentPage);
  }

  // Ausrichtung je Zeile (vor dem Zusammenlegen der Doppelseiten).
  // Wirkt nur, wenn eine Zeile NICHT voll ist (freier Platz vorhanden).
  // Jedes Foto kann eine eigene Ausrichtung haben (imageAlignments);
  // ohne eigene gilt die Seiten-Ausrichtung. Links-Bilder werden links
  // gepackt, Rechts-Bilder rechts, Mittig-Bilder mittig dazwischen —
  // dadurch entstehen keine Überlappungen.
  if (pageAlignments || imageAlignments) {
    for (const page of pages) {
      if (page.photos.length === 0) continue;
      const pageAlign = pageAlignments?.get(page.pageNumber) || "left";

      // Fotos zu Zeilen gruppieren (gleiche Y-Position, kleine Toleranz).
      const rows: PhotoBox[][] = [];
      const tolerance = 1;
      for (const photo of page.photos) {
        const row = rows.find((r) => Math.abs(r[0].y - photo.y) <= tolerance);
        if (row) row.push(photo);
        else rows.push([photo]);
      }

      for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
        const minLeftEdge = Math.min(...row.map((p) => p.x));
        const maxRightEdge = Math.max(...row.map((p) => p.x + p.width));
        const leftover = contentWidth - (maxRightEdge - minLeftEdge);
        // Volle Zeile -> nichts auszurichten.
        if (leftover <= 0.5) continue;

        const effAlign = (p: PhotoBox): PageAlignment =>
          imageAlignments?.get(p.asset.id) ?? pageAlign;
        const bucketL = row.filter((p) => effAlign(p) === "left");
        const bucketC = row.filter((p) => effAlign(p) === "center");
        const bucketR = row.filter((p) => effAlign(p) === "right");
        const bucketWidth = (arr: PhotoBox[]) =>
          arr.length
            ? arr.reduce((s, p) => s + p.width, 0) + (arr.length - 1) * spacing
            : 0;
        const wL = bucketWidth(bucketL);
        const wC = bucketWidth(bucketC);
        const wR = bucketWidth(bucketR);

        const left0 = margin;
        const right0 = margin + contentWidth;

        // Links packen
        let x = left0;
        for (const p of bucketL) {
          p.x = x;
          x += p.width + spacing;
        }
        // Rechts packen (von rechts nach links)
        let xr = right0;
        for (let i = bucketR.length - 1; i >= 0; i--) {
          xr -= bucketR[i].width;
          bucketR[i].x = xr;
          xr -= spacing;
        }
        // Mittig zwischen den beiden Blöcken
        if (bucketC.length) {
          const cMin = left0 + (wL ? wL + spacing : 0);
          const cMax = right0 - (wR ? wR + spacing : 0);
          const cStart = Math.max(
            cMin,
            Math.min((left0 + right0) / 2 - wC / 2, cMax - wC),
          );
          let xc = cStart;
          for (const p of bucketC) {
            p.x = xc;
            xc += p.width + spacing;
          }
        }
      }
    }
  }

  // Combine pages if requested
  if (options.combinePages) {
    return combinePagesSideBySide(pages, pageDimensions.width);
  }

  return pages;
}

/* ------------------------------------------------------------------ */
/* Collage-Layout: justierte Bänder aus Spalten (Stapeln).            */
/* Jede Spalte ist ein vertikaler Stapel aus 1..n Kacheln; alle       */
/* Spalten eines Bandes sind gleich hoch und auf Seitenbreite         */
/* justiert -> seitenverhältnis-erhaltend, zeilenübergreifend.        */
/* Ausgabe identisch zu calculatePageLayout (Page[]/PhotoBox[]).      */
/* ------------------------------------------------------------------ */

interface CollageTile {
  asset: AssetResponseDto;
  aspect: number; // width / height
  factor: number; // Höhenfaktor (>=2 => hohe Solo-Kachel)
}
interface CollageColumn {
  tiles: CollageTile[];
}
interface CollageBand {
  columns: CollageColumn[];
  double: boolean; // true => Zielhöhe = 2 Basiszeilen (enthält hohe Kachel)
  full: boolean; // true => Band füllt die Breite (justieren); false => nicht strecken
}

function tileAspect(
  asset: AssetResponseDto,
  customAspectRatios?: Map<string, number>,
): number {
  const custom = customAspectRatios?.get(asset.id);
  if (custom) return custom;
  const w = asset.exifInfo?.exifImageWidth || 1;
  const h = asset.exifInfo?.exifImageHeight || 1;
  if (asset.exifInfo?.orientation == "6") return h / w;
  return w / h;
}

// Summe der Kehrwerte der Seitenverhältnisse einer Spalte.
function colInvAspectSum(col: CollageColumn): number {
  return col.tiles.reduce((s, t) => s + 1 / t.aspect, 0);
}
// Natürliche Spaltenbreite bei Bandhöhe H (aspect-erhaltend, mit Zwischen-Gaps).
function colWidthAt(col: CollageColumn, H: number, spacing: number): number {
  const gaps = (col.tiles.length - 1) * spacing;
  return Math.max(1, (H - gaps) / colInvAspectSum(col));
}
function bandNaturalWidth(
  cols: CollageColumn[],
  H: number,
  spacing: number,
): number {
  const inner = cols.reduce((s, c) => s + colWidthAt(c, H, spacing), 0);
  return inner + (cols.length - 1) * spacing;
}
// Bandhöhe H, sodass die Bandbreite exakt contentWidth ergibt.
function solveBandHeight(
  cols: CollageColumn[],
  contentWidth: number,
  spacing: number,
): number {
  const K = cols.length;
  let sumInvS = 0;
  let sumNm1overS = 0;
  for (const c of cols) {
    const S = colInvAspectSum(c);
    sumInvS += 1 / S;
    sumNm1overS += (c.tiles.length - 1) / S;
  }
  if (sumInvS <= 0) return contentWidth;
  return (contentWidth + spacing * sumNm1overS - (K - 1) * spacing) / sumInvS;
}

export function calculateCollageLayout(
  assets: AssetResponseDto[],
  options: LayoutOptions,
): Page[] {
  if (assets.length === 0) return [];

  const { margin, rowHeight, spacing, customAspectRatios, heightFactors } =
    options;

  let pageDimensions: { width: number; height: number };
  if (options.pageSize === "CUSTOM" && options.customWidth && options.customHeight) {
    pageDimensions = { width: options.customWidth, height: options.customHeight };
  } else if (options.pageSize !== "CUSTOM") {
    pageDimensions = PAGE_SIZES[options.pageSize][options.orientation];
  } else {
    pageDimensions = PAGE_SIZES.A4.portrait;
  }
  const contentWidth = pageDimensions.width - margin * 2;
  const contentHeight = pageDimensions.height - margin * 2;

  const H1 = rowHeight; // Basis-Bandhöhe (eine Zeile)
  const H2 = rowHeight * 2 + spacing; // Doppelband (hohe Kachel)

  const tiles: CollageTile[] = assets.map((asset) => ({
    asset,
    aspect: tileAspect(asset, customAspectRatios),
    factor: heightFactors?.get(asset.id) ?? 1,
  }));

  // 1) Bänder + Spalten bilden.
  const bands: CollageBand[] = [];
  let i = 0;
  while (i < tiles.length) {
    if (tiles[i].factor >= 2) {
      // Doppelband: hohe Solo-Kachel + gestapelte Paare daneben. Die Nachbarn
      // werden unabhängig von ihrem Faktor gestapelt (in einem Doppelband
      // angeordnete Bilder gelten als normal hoch), bis die Breite gefüllt ist.
      const columns: CollageColumn[] = [{ tiles: [tiles[i]] }];
      i++;
      let full = false;
      while (
        i + 1 < tiles.length &&
        bandNaturalWidth(columns, H2, spacing) < contentWidth
      ) {
        columns.push({ tiles: [tiles[i], tiles[i + 1]] });
        i += 2;
      }
      if (bandNaturalWidth(columns, H2, spacing) >= contentWidth) full = true;
      bands.push({ columns, double: true, full });
    } else {
      // Einfaches Band: justierte Zeile aus Einzel-Kacheln.
      const columns: CollageColumn[] = [];
      let full = false;
      while (i < tiles.length && tiles[i].factor < 2) {
        columns.push({ tiles: [tiles[i]] });
        i++;
        if (bandNaturalWidth(columns, H1, spacing) >= contentWidth) {
          full = true;
          break;
        }
      }
      bands.push({ columns, double: false, full });
    }
  }

  // 2) Bänder platzieren + paginieren.
  const pages: Page[] = [];
  let currentPage: Page = {
    pageNumber: 1,
    photos: [],
    width: pageDimensions.width,
    height: pageDimensions.height,
  };
  let bandY = 0; // laufende Y-Position über alle Seiten
  let pageStartY = 0;

  for (const band of bands) {
    const target = band.double ? H2 : H1;
    // Justieren, wenn das Band die Breite füllt; sonst Zielhöhe (nicht strecken).
    let H = band.full
      ? solveBandHeight(band.columns, contentWidth, spacing)
      : target;
    // Sicherheitsklammer gegen entartete Höhen.
    H = Math.max(60, Math.min(H, contentHeight));

    // Seitenumbruch, wenn das Band nicht mehr auf die Seite passt.
    if (
      currentPage.photos.length > 0 &&
      bandY + H - pageStartY > contentHeight
    ) {
      pages.push(currentPage);
      currentPage = {
        pageNumber: pages.length + 1,
        photos: [],
        width: pageDimensions.width,
        height: pageDimensions.height,
      };
      pageStartY = bandY;
    }

    // Spalten von links nach rechts platzieren.
    let x = margin;
    const topY = bandY - pageStartY + margin;
    for (const col of band.columns) {
      const w = colWidthAt(col, H, spacing);
      let y = topY;
      for (const t of col.tiles) {
        const h = w / t.aspect;
        currentPage.photos.push({
          asset: t.asset,
          x,
          y,
          width: w,
          height: h,
        });
        y += h + spacing;
      }
      x += w + spacing;
    }

    bandY += H + spacing;
  }
  if (currentPage.photos.length > 0) pages.push(currentPage);

  if (options.combinePages) {
    return combinePagesSideBySide(pages, pageDimensions.width);
  }
  return pages;
}

// Ein einzelnes Band ab Index `start` bilden (Collage-Doppelband oder
// justiertes Einzelband). `honorFactors` = Collage-Modus (hohe Kacheln).
function buildOneBand(
  tiles: CollageTile[],
  start: number,
  honorFactors: boolean,
  contentWidth: number,
  H1: number,
  H2: number,
  spacing: number,
): { band: CollageBand; nextI: number } {
  let i = start;
  if (honorFactors && tiles[i].factor >= 2) {
    const columns: CollageColumn[] = [{ tiles: [tiles[i]] }];
    i++;
    while (
      i + 1 < tiles.length &&
      bandNaturalWidth(columns, H2, spacing) < contentWidth
    ) {
      columns.push({ tiles: [tiles[i], tiles[i + 1]] });
      i += 2;
    }
    const full = bandNaturalWidth(columns, H2, spacing) >= contentWidth;
    return { band: { columns, double: true, full }, nextI: i };
  }
  const columns: CollageColumn[] = [];
  let full = false;
  while (i < tiles.length && !(honorFactors && tiles[i].factor >= 2)) {
    columns.push({ tiles: [tiles[i]] });
    i++;
    if (bandNaturalWidth(columns, H1, spacing) >= contentWidth) {
      full = true;
      break;
    }
  }
  return { band: { columns, double: false, full }, nextI: i };
}

// Die Fotos EINER logischen Seite in einem Modus neu anordnen (fester Foto-Satz,
// keine Paginierung -> alle bleiben auf dieser Seite). Für Per-Seite-Overrides.
function relayLogicalPage(
  photos: PhotoBox[],
  mode: "justified" | "collage",
  contentWidth: number,
  H1: number,
  H2: number,
  spacing: number,
  margin: number,
  customAspectRatios?: Map<string, number>,
  heightFactors?: Map<string, number>,
): PhotoBox[] {
  const honorFactors = mode === "collage";
  const tiles: CollageTile[] = photos.map((p) => ({
    asset: p.asset,
    aspect: tileAspect(p.asset, customAspectRatios),
    factor: heightFactors?.get(p.asset.id) ?? 1,
  }));
  const out: PhotoBox[] = [];
  let bandY = 0;
  let i = 0;
  while (i < tiles.length) {
    const { band, nextI } = buildOneBand(
      tiles,
      i,
      honorFactors,
      contentWidth,
      H1,
      H2,
      spacing,
    );
    let H = band.full
      ? solveBandHeight(band.columns, contentWidth, spacing)
      : band.double
        ? H2
        : H1;
    H = Math.max(60, H);
    let x = margin;
    const topY = bandY + margin;
    for (const col of band.columns) {
      const w = colWidthAt(col, H, spacing);
      let y = topY;
      for (const t of col.tiles) {
        const h = w / t.aspect;
        out.push({ asset: t.asset, x, y, width: w, height: h });
        y += h + spacing;
      }
      x += w + spacing;
    }
    bandY += H + spacing;
    i = nextI;
  }
  return out;
}

/**
 * Per-Seite-Layout OHNE das ganze Buch umzubrechen: Die Basis-Pagination kommt
 * vom Standard-Layout (layoutMode) und bleibt damit exakt wie bisher; nur
 * logische Seiten mit abweichendem Modus (pageLayoutModes) werden IN SICH neu
 * angeordnet. Wird nur genutzt, wenn es Per-Seite-Overrides gibt.
 */
export function calculateBookLayoutPerPage(
  assets: AssetResponseDto[],
  options: LayoutOptions,
): Page[] {
  if (assets.length === 0) return [];
  const { margin, rowHeight, spacing, customAspectRatios, heightFactors } =
    options;
  const defaultMode = options.layoutMode ?? "justified";

  let pageDimensions: { width: number; height: number };
  if (
    options.pageSize === "CUSTOM" &&
    options.customWidth &&
    options.customHeight
  ) {
    pageDimensions = {
      width: options.customWidth,
      height: options.customHeight,
    };
  } else if (options.pageSize !== "CUSTOM") {
    pageDimensions = PAGE_SIZES[options.pageSize][options.orientation];
  } else {
    pageDimensions = PAGE_SIZES.A4.portrait;
  }
  const contentWidth = pageDimensions.width - margin * 2;
  const H1 = rowHeight;
  const H2 = rowHeight * 2 + spacing;

  // 1) Basis: logische Seiten im Standard-Modus (OHNE Zusammenlegen).
  const baseOptions: LayoutOptions = { ...options, combinePages: false };
  const logical =
    defaultMode === "collage"
      ? calculateCollageLayout(assets, baseOptions)
      : calculatePageLayout(assets, baseOptions);

  // 2) Nur Seiten mit abweichendem Modus in sich neu anordnen.
  for (const page of logical) {
    const mode = options.pageLayoutModes?.get(page.pageNumber) ?? defaultMode;
    if (mode === defaultMode) continue;
    page.photos = relayLogicalPage(
      page.photos,
      mode,
      contentWidth,
      H1,
      H2,
      spacing,
      margin,
      customAspectRatios,
      heightFactors,
    );
  }

  // 3) Doppelseiten wie üblich zusammenlegen.
  if (options.combinePages) {
    return combinePagesSideBySide(logical, pageDimensions.width);
  }
  return logical;
}

// Zwei aufeinanderfolgende Seiten zu einer Doppelseite zusammenfassen.
function combinePagesSideBySide(pages: Page[], pageWidth: number): Page[] {
  const combined: Page[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const left = pages[i];
    const right = pages[i + 1];
    if (right) {
      combined.push({
        pageNumber: Math.floor(i / 2) + 1,
        photos: [
          ...left.photos,
          ...right.photos.map((p) => ({ ...p, x: p.x + pageWidth })),
        ],
        width: pageWidth * 2,
        height: left.height,
      });
    } else {
      combined.push({
        ...left,
        pageNumber: Math.floor(i / 2) + 1,
        width: pageWidth * 2,
      });
    }
  }
  return combined;
}
