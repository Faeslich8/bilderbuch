/**
 * Gemeinsamer Renderer für Editor (Web) UND Export (PDF) – Phase 2.
 *
 * Ziel/Invariante (CLAUDE.md 1 & 5): Vorschau und PDF dürfen Geometrie NIE
 * unabhängig berechnen. Hier liegt deshalb die EINE Quelle für Position/Größe/
 * Rotation und die Layout-Entscheidungen (Bildaufteilung bei left/right,
 * Datums-Ecke, Beschriftungs-Position). `WebElement` und `PdfElement` sind nur
 * zwei dünne Adapter, die diese Werte in HTML/Tailwind bzw. @react-pdf-Knoten
 * übersetzen – sie können dadurch konstruktiv nicht auseinanderdriften.
 *
 * Hinweis zur Beschriftung/Datum: Diese werden in Phase 2 noch über `ctx`
 * (descPosition + Texte, aus den alten `descriptionPositions` abgeleitet)
 * übergeben, NICHT über `ImageElement.caption`. Die Umstellung auf das
 * caption-Feld des Modells erfolgt laut Plan erst in Phase 6.
 */
import { View, Image, Text, StyleSheet } from "@react-pdf/renderer";
import type { ImageElement, TextElement } from "../types/pageElement";
import type { Position } from "../utils/albumConfig";
import { toPoints } from "../utils/units";

/* ------------------------------------------------------------------ */
/* Stile (aus PhotoGrid hierher gezogen – einziger Ort für Render-Stil) */
/* ------------------------------------------------------------------ */

export const photoStaticStyles = StyleSheet.create({
  photoContainer: {
    position: "absolute",
  },
  photo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
});

/** Dynamische PDF-Stile (abhängig von der Schriftgröße). */
export const createDynamicStyles = (fontSize: number) => {
  const basePadding = fontSize * 0.67;

  return {
    text: {
      color: "black",
      fontSize: fontSize,
      fontFamily: "Roboto",
      lineHeight: 1,
      letterSpacing: 0.2,
    },
    dateOverlay: {
      backgroundColor: "rgba(255, 255, 255, 0.7)",
      paddingHorizontal: basePadding,
      paddingVertical: basePadding * 0.5,
      borderRadius: basePadding * 0.5,
    },
    descriptionOverlay: {
      backgroundColor: "rgba(255, 255, 255, 0.7)",
      color: "black",
      fontSize: fontSize,
      padding: basePadding,
      fontFamily: "Roboto",
      lineHeight: 1,
      letterSpacing: 0.2,
    },
    descriptionSide: {
      padding: basePadding,
      display: "flex" as const,
      justifyContent: "center" as const,
      backgroundColor: "#F3F4F6",
    },
  };
};

/** Dynamische Web-Vorschau-Stile (abhängig von der Schriftgröße). */
export const createWebStyles = (fontSize: number) => {
  const basePadding = fontSize * 0.67;

  return {
    date: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding * 0.5}px ${basePadding}px`,
      borderRadius: `${basePadding * 0.5}px`,
      lineHeight: 1,
    },
    description: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding}px`,
      lineHeight: 1,
    },
    descriptionSide: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding}px`,
      lineHeight: 1,
    },
  };
};

export type PdfStyles = ReturnType<typeof createDynamicStyles>;
export type WebStyles = ReturnType<typeof createWebStyles>;

/* ------------------------------------------------------------------ */
/* Geteilte, reine Geometrie-/Layout-Helfer (DIE einzige Quelle).      */
/* ------------------------------------------------------------------ */

/** Container-Box eines Elements (Punkte). Gleiche Zahlen für Web (px) und PDF (pt). */
export function elementBoxStyle(el: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}) {
  const base = {
    left: toPoints(el.x),
    top: toPoints(el.y),
    width: toPoints(el.width),
    height: toPoints(el.height),
  };
  if (el.rotation) {
    return {
      ...base,
      transform: `rotate(${el.rotation}deg)`,
      transformOrigin: "center",
    };
  }
  return base;
}

/**
 * Bei left/right-Beschriftung hat die Layout-Engine die Box bereits verdoppelt;
 * wir teilen sie hier in Bild- und Beschriftungs-Spalte (je halbe Breite).
 */
export function imageSplit(element: ImageElement, isLeftRight: boolean) {
  const widthPt = toPoints(element.width);
  return {
    containerWidth: widthPt,
    imageWidth: isLeftRight ? widthPt / 2 : widthPt,
    height: toPoints(element.height),
  };
}

function isLeftRightPos(descPosition: Position, hasDescription: boolean): boolean {
  return (
    hasDescription && (descPosition === "left" || descPosition === "right")
  );
}

/** Absolute Position des Datums-Badges (Punkte) + ob es auf dem hellen Overlay sitzt. */
function dateBadgePlacement(
  descPosition: Position,
  imageWidth: number,
): {
  style: {
    position: "absolute";
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  overlayBg: boolean;
} {
  switch (descPosition) {
    case "top":
      return { style: { position: "absolute", bottom: 8, right: 8 }, overlayBg: true };
    case "left":
      return { style: { position: "absolute", top: 16, left: 8 }, overlayBg: false };
    case "right":
      return {
        style: { position: "absolute", top: 16, left: imageWidth + 8 },
        overlayBg: false,
      };
    case "bottom":
    default:
      return { style: { position: "absolute", top: 8, right: 8 }, overlayBg: true };
  }
}

/* ------------------------------------------------------------------ */
/* Kontext, den beide Adapter zum Rendern eines Bild-Elements brauchen. */
/* ------------------------------------------------------------------ */

export interface PdfImageContext {
  imageUrl: string;
  descPosition: Position;
  /** Bereits upstream über showDescriptions gefiltert; leer/undefined ⇒ nicht zeigen. */
  description?: string | null;
  /** Bereits upstream über showDates + fileCreatedAt gefiltert; undefined ⇒ nicht zeigen. */
  dateText?: string;
  styles: PdfStyles;
}

export interface WebImageContext {
  imageUrl: string;
  alt?: string;
  descPosition: Position;
  description?: string | null;
  dateText?: string;
  styles: WebStyles;
  /** Web-only: Klick auf Datum/Beschreibung (Position zyklieren). PDF ignoriert das. */
  onLabelClick?: (event: React.MouseEvent) => void;
}

/* ------------------------------------------------------------------ */
/* PDF-Adapter.                                                         */
/* ------------------------------------------------------------------ */

export function PdfElement({
  element,
  ctx,
}: {
  element: ImageElement;
  ctx: PdfImageContext;
}) {
  const { imageUrl, descPosition, description, dateText, styles } = ctx;
  const hasDescription = !!description;
  const isLeftRight = isLeftRightPos(descPosition, hasDescription);
  const { imageWidth, height } = imageSplit(element, isLeftRight);

  return (
    <View style={[photoStaticStyles.photoContainer, elementBoxStyle(element)]}>
      {/* Beschreibung links */}
      {hasDescription && descPosition === "left" && (
        <View
          style={[
            styles.descriptionSide,
            { position: "absolute", left: 0, top: 0, width: imageWidth, height },
          ]}
        >
          <Text hyphenationCallback={(word) => [word]} style={styles.text}>
            {description}
          </Text>
        </View>
      )}

      {/* Bild */}
      <Image
        src={imageUrl}
        style={
          isLeftRight
            ? {
                position: "absolute",
                left: descPosition === "left" ? imageWidth : 0,
                top: 0,
                width: imageWidth,
                height,
                objectFit: "cover",
              }
            : photoStaticStyles.photo
        }
      />

      {/* Beschreibung rechts */}
      {hasDescription && descPosition === "right" && (
        <View
          style={[
            styles.descriptionSide,
            { position: "absolute", right: 0, top: 0, width: imageWidth, height },
          ]}
        >
          <Text hyphenationCallback={(word) => [word]} style={styles.text}>
            {description}
          </Text>
        </View>
      )}

      {/* Datum */}
      {dateText &&
        (() => {
          const { style: pos, overlayBg } = dateBadgePlacement(
            descPosition,
            imageWidth,
          );
          return (
            <View style={overlayBg ? { ...styles.dateOverlay, ...pos } : pos}>
              <Text style={styles.text}>{dateText}</Text>
            </View>
          );
        })()}

      {/* Beschreibung oben/unten (Overlay) */}
      {hasDescription &&
        (descPosition === "top" || descPosition === "bottom") && (
          <Text
            hyphenationCallback={(word) => [word]}
            style={{
              ...styles.descriptionOverlay,
              position: "absolute",
              ...(descPosition === "top" ? { top: 0 } : { bottom: 0 }),
              left: 0,
              right: 0,
            }}
          >
            {description}
          </Text>
        )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Web-Adapter (nur der sichtbare Inhalt; Interaktions-Chrome bleibt    */
/* im PhotoGrid-Container und umschließt dieses Fragment).              */
/* ------------------------------------------------------------------ */

export function WebElement({
  element,
  ctx,
}: {
  element: ImageElement;
  ctx: WebImageContext;
}) {
  const { imageUrl, alt, descPosition, description, dateText, styles, onLabelClick } =
    ctx;
  const hasDescription = !!description;
  const isLeftRight = isLeftRightPos(descPosition, hasDescription);
  const { imageWidth } = imageSplit(element, isLeftRight);

  return (
    <>
      {/* Beschreibung links (Flex-Spalte) */}
      {hasDescription && descPosition === "left" && (
        <div
          className="text-black cursor-pointer bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
          style={{ width: `${imageWidth}px`, flexShrink: 0, ...styles.descriptionSide }}
          onClick={onLabelClick}
          title="Click to change position"
        >
          {description}
        </div>
      )}

      {/* Bild */}
      <img
        src={imageUrl}
        alt={alt}
        className="object-cover w-full h-full"
        style={isLeftRight ? { width: `${imageWidth}px`, flexShrink: 0 } : undefined}
        loading="lazy"
      />

      {/* Datum */}
      {dateText &&
        (() => {
          const { style: pos, overlayBg } = dateBadgePlacement(
            descPosition,
            imageWidth,
          );
          const inset = {
            top: pos.top != null ? `${pos.top}px` : undefined,
            bottom: pos.bottom != null ? `${pos.bottom}px` : undefined,
            left: pos.left != null ? `${pos.left}px` : undefined,
            right: pos.right != null ? `${pos.right}px` : undefined,
          };
          return (
            <div
              className={`absolute text-black cursor-pointer ${
                overlayBg
                  ? "bg-white/70 backdrop-blur-sm hover:bg-white/80 transition-colors"
                  : ""
              }`}
              style={{ ...inset, ...styles.date }}
              onClick={onLabelClick}
              title="Click to change position"
            >
              {dateText}
            </div>
          );
        })()}

      {/* Beschreibung oben/unten (Overlay) */}
      {hasDescription &&
        (descPosition === "top" || descPosition === "bottom") && (
          <div
            className={`absolute left-0 right-0 bg-white/70 text-black cursor-pointer hover:bg-white/80 transition-colors z-10 ${
              descPosition === "top" ? "top-0" : "bottom-0"
            }`}
            style={styles.description}
            onClick={onLabelClick}
            title="Click to change position"
          >
            {description}
          </div>
        )}

      {/* Beschreibung rechts (Flex-Spalte) */}
      {hasDescription && descPosition === "right" && (
        <div
          className="text-black cursor-pointer bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
          style={{ width: `${imageWidth}px`, flexShrink: 0, ...styles.descriptionSide }}
          onClick={onLabelClick}
          title="Click to change position"
        >
          {description}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Text-Adapter (Phase 5).                                             */
/* ------------------------------------------------------------------ */

/** Web: sichtbarer Inhalt eines Textfelds (Container kommt aus PhotoGrid). */
export function WebTextElement({ element }: { element: TextElement }) {
  const hasText = element.text.trim().length > 0;
  return (
    <div
      className="w-full h-full overflow-hidden"
      style={{
        fontFamily: element.fontFamily,
        fontSize: `${element.fontSize}px`,
        color: hasText ? element.color : "#9ca3af",
        textAlign: element.align,
        fontWeight: element.fontWeight,
        fontStyle: element.italic ? "italic" : undefined,
        backgroundColor: element.backgroundColor,
        lineHeight: 1.25,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        padding: 4,
      }}
    >
      {hasText ? element.text : "Text eingeben…"}
    </div>
  );
}

/** PDF: positioniertes Textfeld. Leerer Text wird NICHT exportiert. */
export function PdfTextElement({ element }: { element: TextElement }) {
  if (element.text.trim().length === 0) return null;
  return (
    <View
      style={[
        photoStaticStyles.photoContainer,
        elementBoxStyle(element),
        element.backgroundColor
          ? { backgroundColor: element.backgroundColor }
          : {},
        { padding: 4 },
      ]}
    >
      <Text
        style={{
          fontFamily: element.fontFamily,
          fontSize: element.fontSize,
          color: element.color,
          textAlign: element.align,
          ...(element.fontWeight ? { fontWeight: element.fontWeight } : {}),
          ...(element.italic ? { fontStyle: "italic" as const } : {}),
          lineHeight: 1.25,
        }}
      >
        {element.text}
      </Text>
    </View>
  );
}
