/**
 * Einheitliches Element-Datenmodell für freie Platzierung in BilderBuch.
 *
 * Phase 1 der Überarbeitung. Diese Datei ist ein ENTWURF zur Freigabe:
 * Solange sie nirgends importiert wird, ändert sie nichts am bestehenden
 * Verhalten. Siehe PHASE1-PageElement-Design.md für Begründung und Migration.
 *
 * Konventionen (vgl. ARCHITECTURE.md / CLAUDE.md):
 *  - Koordinaten in Pixeln bei 300 DPI, relativ zur Seite, Ursprung oben links.
 *  - rotation in Grad, im Uhrzeigersinn, Drehpunkt = Element-Mitte.
 *  - Für den PDF-Export werden Werte zentral mit (72/300) in Punkte umgerechnet.
 */

import { randomId } from "../utils/id";

export type ElementType = "image" | "text" | "shape" | "emoji";

/** Eigenschaften, die jedes Element besitzt. */
export interface BaseElement {
  /** Stabile ID, z. B. crypto.randomUUID(). */
  id: string;
  type: ElementType;
  /** Obere linke Ecke, Pixel @ 300 DPI, relativ zur Seite. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grad, im Uhrzeigersinn. Drehpunkt = Mitte des Elements. */
  rotation: number;
  /** Stapelreihenfolge innerhalb der Seite (höher = weiter vorne). */
  zIndex: number;
  /** Optional gegen versehentliches Verschieben/Skalieren sperren. */
  locked?: boolean;
}

/**
 * Position einer Bildbeschriftung relativ zum Bild.
 * Enthält bewusst auch "left"/"right", damit die alten
 * `descriptionPositions` (bottom/top/left/right) verlustfrei migriert werden
 * können (siehe utils/migration.ts).
 */
export type CaptionPosition =
  | "below"
  | "above"
  | "overlay-bottom"
  | "overlay-top"
  | "left"
  | "right";

/** Beschriftung, die an einem Bild hängt (Phase 6). */
export interface ElementCaption {
  text: string;
  position: CaptionPosition;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

/** Bild aus einem Immich-Album. */
export interface ImageElement extends BaseElement {
  type: "image";
  /** Immich-Asset-ID. */
  assetId: string;
  /** Externe Bildquelle (Data-URL); wenn gesetzt, ersetzt sie die Immich-Asset-URL. */
  src?: string;
  objectFit?: "cover" | "contain";
  /** Seitenverhältnis beim Skalieren sperren (Phase 4). */
  lockAspectRatio?: boolean;
  /** Stammt aus dem Auto-Layout oder wurde manuell platziert. */
  source: "auto" | "manual";
  /** Optionale, mitwandernde Beschriftung (Phase 6). */
  caption?: ElementCaption;
}

/** Frei platzierbares, editierbares Textfeld. */
export interface TextElement extends BaseElement {
  type: "text";
  /** Leerer Text = Platzhalter. Im Export wird NUR eingegebener Text gezeigt. */
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  fontWeight?: 400 | 500 | 700;
  italic?: boolean;
  /** Hintergrund hinter dem Text; transparent, wenn nicht gesetzt. */
  backgroundColor?: string;
}

/** Form als SVG-artiges Primitiv. */
export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Eckenradius für shape === "rect". */
  radius?: number;
}

/** Emoji als Unicode-Zeichen. */
export interface EmojiElement extends BaseElement {
  type: "emoji";
  /** Unicode-Emoji, z. B. "🎉". Darstellungsgröße folgt aus width/height. */
  emoji: string;
}

/** Diskriminierte Union aller Element-Typen. */
export type PageElement =
  | ImageElement
  | TextElement
  | ShapeElement
  | EmojiElement;

/** Eine Buchseite ist eine geordnete Liste von Elementen. */
export interface ElementPage {
  /** Stabile Seiten-ID (empfohlen statt volatiler Seitennummer). */
  id: string;
  width: number;
  height: number;
  elements: PageElement[];
}

/* ------------------------------------------------------------------ */
/* Typ-Guards – praktisch für den gemeinsamen Renderer (Phase 2).      */
/* ------------------------------------------------------------------ */

export const isImageElement = (el: PageElement): el is ImageElement =>
  el.type === "image";
export const isTextElement = (el: PageElement): el is TextElement =>
  el.type === "text";
export const isShapeElement = (el: PageElement): el is ShapeElement =>
  el.type === "shape";
export const isEmojiElement = (el: PageElement): el is EmojiElement =>
  el.type === "emoji";

/* ------------------------------------------------------------------ */
/* Factory-Helfer mit sinnvollen Defaults.                             */
/* ------------------------------------------------------------------ */

let zCounter = 1;
const nextId = (): string => randomId("el-");

export function createTextElement(
  partial: Partial<TextElement> = {},
): TextElement {
  return {
    id: nextId(),
    type: "text",
    x: 100,
    y: 100,
    width: 600,
    height: 200,
    rotation: 0,
    zIndex: zCounter++,
    text: "",
    fontFamily: "Roboto",
    fontSize: 48,
    color: "#000000",
    align: "left",
    fontWeight: 400,
    ...partial,
  };
}

export function createShapeElement(
  partial: Partial<ShapeElement> = {},
): ShapeElement {
  return {
    id: nextId(),
    type: "shape",
    x: 100,
    y: 100,
    width: 400,
    height: 400,
    rotation: 0,
    zIndex: zCounter++,
    shape: "rect",
    fill: "#3b82f6",
    stroke: undefined,
    strokeWidth: 0,
    ...partial,
  };
}

export function createEmojiElement(
  emoji: string,
  partial: Partial<EmojiElement> = {},
): EmojiElement {
  return {
    id: nextId(),
    type: "emoji",
    x: 100,
    y: 100,
    width: 300,
    height: 300,
    rotation: 0,
    zIndex: zCounter++,
    emoji,
    ...partial,
  };
}

export function createImageElement(
  assetId: string,
  partial: Partial<ImageElement> = {},
): ImageElement {
  return {
    id: nextId(),
    type: "image",
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    rotation: 0,
    zIndex: zCounter++,
    assetId,
    objectFit: "cover",
    lockAspectRatio: true,
    source: "manual",
    ...partial,
  };
}
