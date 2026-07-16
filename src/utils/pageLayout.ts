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

  // Apply page alignments per row (before combining pages)
  if (pageAlignments) {
    for (const page of pages) {
      const alignment = pageAlignments.get(page.pageNumber) || "left";

      if (page.photos.length > 0 && alignment !== "left") {
        // Group photos by row (photos with same Y position, allowing small tolerance)
        const rows: PhotoBox[][] = [];
        const tolerance = 1; // 1 pixel tolerance for grouping rows

        for (const photo of page.photos) {
          // Find existing row with matching Y position
          let foundRow = false;
          for (const row of rows) {
            if (Math.abs(row[0].y - photo.y) <= tolerance) {
              row.push(photo);
              foundRow = true;
              break;
            }
          }
          // Create new row if no matching row found
          if (!foundRow) {
            rows.push([photo]);
          }
        }

        // Apply alignment to each row independently
        for (const row of rows) {
          const minLeftEdge = Math.min(...row.map((photo) => photo.x));
          const maxRightEdge = Math.max(
            ...row.map((photo) => photo.x + photo.width)
          );

          let shift = 0;
          if (alignment === "right") {
            // Calculate shift needed to align right edge to content area
            const rightEdge = margin + contentWidth;
            shift = rightEdge - maxRightEdge;
          } else if (alignment === "center") {
            // Calculate shift needed to center the content
            const usedWidth = maxRightEdge - minLeftEdge;
            const availableSpace = contentWidth - usedWidth;
            const targetLeftEdge = margin + availableSpace / 2;
            shift = targetLeftEdge - minLeftEdge;
          }

          // Apply shift to all photos in this row
          for (const photo of row) {
            photo.x += shift;
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
