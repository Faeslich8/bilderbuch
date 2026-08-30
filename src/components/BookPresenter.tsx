/**
 * Vollbild-Präsentation des fertigen Buchs — zum Blättern am Fernseher oder
 * Tablet.
 *
 * Die Seiten werden NICHT neu gestaltet: Diese Komponente bekommt die fertig
 * gerenderten Seiten als Knoten herein (siehe PhotoGrid) und kümmert sich nur um
 * Vollbild, Skalierung und Navigation. Dadurch sieht die Präsentation exakt so
 * aus wie die Vorschau und der PDF-Export — es gibt keinen zweiten Renderpfad,
 * der auseinanderdriften könnte.
 *
 * Bedienung:
 *  - Fernseher/Fernbedienung: Pfeiltasten, Bild auf/ab, Leertaste, Pos1/Ende, Esc
 *  - Tablet: Wischen nach links/rechts, Tippen auf die linke/rechte Bildkante
 *  - Maus: Klick links/rechts, Mausrad
 * Die Bedienelemente blenden sich nach kurzer Ruhe aus, damit nur das Buch bleibt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@mdi/react";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiFullscreen,
  mdiFullscreenExit,
} from "@mdi/js";

export interface PresentSheet {
  key: string;
  /** Anzeigebreite in Punkten (72 dpi) – wie in der Vorschau. */
  width: number;
  height: number;
  node: React.ReactNode;
}

interface Props {
  sheets: PresentSheet[];
  /** Hintergrund hinter dem Blatt (Bühne). */
  stageColor?: string;
  startIndex?: number;
  onClose: () => void;
}

const IDLE_MS = 2600;

export default function BookPresenter({
  sheets,
  stageColor = "#111310",
  startIndex = 0,
  onClose,
}: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, sheets.length - 1)),
  );
  const [showChrome, setShowChrome] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const last = sheets.length - 1;
  // Richtung der letzten Bewegung – steuert, aus welcher Seite das neue Blatt
  // hereinschwenkt.
  const [dir, setDir] = useState<1 | -1>(1);
  const go = useCallback(
    (delta: number) => {
      if (delta !== 0) setDir(delta > 0 ? 1 : -1);
      setIndex((i) => Math.min(last, Math.max(0, i + delta)));
    },
    [last],
  );

  /** Bedienelemente zeigen und den Ausblend-Timer neu starten. */
  const wake = useCallback(() => {
    setShowChrome(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setShowChrome(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [wake]);

  /* Vollbild ------------------------------------------------------- */

  const enterFullscreen = useCallback(async () => {
    try {
      await rootRef.current?.requestFullscreen?.();
    } catch {
      /* Vollbild kann abgelehnt werden – die Präsentation läuft trotzdem. */
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* egal */
      }
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen]);

  useEffect(() => {
    // Beim Öffnen direkt ins Vollbild – der Aufruf stammt aus einem Klick,
    // daher erlaubt der Browser ihn.
    void enterFullscreen();
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [enterFullscreen]);

  /* Größe ---------------------------------------------------------- */

  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      setViewport({
        w: el?.clientWidth || window.innerWidth,
        h: el?.clientHeight || window.innerHeight,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const t = window.setInterval(measure, 500); // fängt Vollbildwechsel mit ab
    return () => {
      window.removeEventListener("resize", measure);
      window.clearInterval(t);
    };
  }, []);

  /* Tastatur ------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      wake();
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          go(-1);
          break;
        case "Home":
          e.preventDefault();
          setIndex(0);
          break;
        case "End":
          e.preventDefault();
          setIndex(last);
          break;
        case "Escape":
          // Im Vollbild schließt Esc zuerst das Vollbild (Browser-Verhalten);
          // ein zweites Esc beendet dann die Präsentation.
          if (!document.fullscreenElement) onClose();
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, last, onClose, toggleFullscreen, wake]);

  /* Aktuelles Blatt und Skalierung --------------------------------- */

  const sheet = sheets[index];
  const scale = useMemo(() => {
    if (!sheet || !viewport.w || !viewport.h) return 1;
    // Etwas Luft lassen, damit das Blatt nicht am Rand klebt.
    const pad = 0.94;
    return Math.min(
      (viewport.w * pad) / sheet.width,
      (viewport.h * pad) / sheet.height,
    );
  }, [sheet, viewport]);

  if (!sheet) return null;

  /* Nachbarblätter unsichtbar mitrendern, damit deren Bilder schon im
     Cache liegen und das Blättern nicht flackert. */
  const neighbours = [index - 1, index + 1].filter(
    (i) => i >= 0 && i <= last,
  );

  const overlay = (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] select-none overflow-hidden"
      style={{ backgroundColor: stageColor }}
      onMouseMove={wake}
      onTouchStart={(e) => {
        wake();
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = touchStart.current;
        touchStart.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        // Nur waagerechte Wischgesten werten – senkrechte könnten Scrollen sein.
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          go(dx < 0 ? 1 : -1);
        }
      }}
      onWheel={(e) => {
        wake();
        if (Math.abs(e.deltaY) > 20) go(e.deltaY > 0 ? 1 : -1);
      }}
    >
      {/* Blätter-Animation: das neue Blatt schwenkt perspektivisch herein –
          vorwärts von rechts, rückwärts von links. Wer im System „Bewegung
          reduzieren" gewählt hat, bekommt keinen Schwenk. */}
      <style>{`
        @keyframes bb-turn-fwd {
          from { transform: perspective(1800px) rotateY(32deg) translateX(9%); opacity: 0.25; }
          to   { transform: perspective(1800px) rotateY(0deg)  translateX(0);  opacity: 1; }
        }
        @keyframes bb-turn-back {
          from { transform: perspective(1800px) rotateY(-32deg) translateX(-9%); opacity: 0.25; }
          to   { transform: perspective(1800px) rotateY(0deg)   translateX(0);   opacity: 1; }
        }
        .bb-turn { animation: bb-turn-fwd 380ms cubic-bezier(0.22, 0.68, 0.35, 1) both; }
        .bb-turn-back { animation: bb-turn-back 380ms cubic-bezier(0.22, 0.68, 0.35, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .bb-turn, .bb-turn-back { animation: none; }
        }
      `}</style>
      {/* Blattfläche.
          Zwei Ebenen, weil sich sonst die Transformationen ins Gehege kämen:
          außen die Wende-Animation (sie setzt transform per Keyframe), innen die
          Skalierung auf die Bildschirmgröße. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          key={sheet.key}
          className={dir === 1 ? "bb-turn" : "bb-turn-back"}
          style={{
            // Die Animationsebene bekommt die SKALIERTEN Maße, damit das
            // Zentrieren stimmt und nichts abgeschnitten wird.
            width: sheet.width * scale,
            height: sheet.height * scale,
            flexShrink: 0,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: sheet.width,
              height: sheet.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
            }}
          >
            {sheet.node}
          </div>
        </div>
      </div>

      {/* Nachbarn vorladen (unsichtbar, ohne Layout-Einfluss) */}
      <div
        aria-hidden
        className="pointer-events-none absolute opacity-0"
        style={{ width: 1, height: 1, overflow: "hidden", left: -9999, top: -9999 }}
      >
        {neighbours.map((i) => (
          <div key={sheets[i].key}>{sheets[i].node}</div>
        ))}
      </div>

      {/* Tippflächen links/rechts (Tablet & Maus) */}
      <button
        aria-label="Vorherige Seite"
        onClick={() => {
          wake();
          go(-1);
        }}
        className="absolute inset-y-0 left-0 w-[28%] cursor-w-resize bg-transparent focus:outline-none"
      />
      <button
        aria-label="Nächste Seite"
        onClick={() => {
          wake();
          go(1);
        }}
        className="absolute inset-y-0 right-0 w-[28%] cursor-e-resize bg-transparent focus:outline-none"
      />

      {/* Bedienelemente – groß genug für Fernbedienung und Finger */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
          showChrome ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Vorherige Seite"
          className="pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-4 text-white backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70 disabled:opacity-25"
        >
          <Icon path={mdiChevronLeft} size={1.6} />
        </button>
        <button
          onClick={() => go(1)}
          disabled={index === last}
          aria-label="Nächste Seite"
          className="pointer-events-auto absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-4 text-white backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70 disabled:opacity-25"
        >
          <Icon path={mdiChevronRight} size={1.6} />
        </button>

        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
          <button
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? "Vollbild beenden" : "Vollbild"}
            className="rounded-full bg-black/45 p-3 text-white backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70"
            title="Vollbild (Taste F)"
          >
            <Icon path={isFullscreen ? mdiFullscreenExit : mdiFullscreen} size={1} />
          </button>
          <button
            onClick={onClose}
            aria-label="Präsentation beenden"
            className="rounded-full bg-black/45 p-3 text-white backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70"
            title="Beenden (Esc)"
          >
            <Icon path={mdiClose} size={1} />
          </button>
        </div>

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-sm text-white backdrop-blur">
          {index + 1} / {sheets.length}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
