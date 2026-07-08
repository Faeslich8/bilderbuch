/**
 * Interaktive Karte für einen Karten-Leerraum (Editor-Vorschau).
 *
 * Zeigt die GPS-Punkte der Fotos einer Seite als Marker auf dem Immich-
 * Kartenstil (MapLibre GL, Vektor-Kacheln von tiles.immich.cloud). Der Nutzer
 * kann zoomen/verschieben; der eingestellte Ausschnitt (center/zoom) und ein
 * PNG-Schnappschuss (für den PDF-Export) werden über onSave zurückgemeldet.
 *
 * Der PDF-Export nutzt NICHT diese Komponente, sondern den gespeicherten
 * Schnappschuss (react-pdf kann kein WebGL rendern).
 */
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapConfig } from "../utils/albumConfig";

/** Immich-Kartenstil (öffentliche Vektor-Kacheln, CORS erlaubt). */
export const IMMICH_MAP_STYLE = "https://tiles.immich.cloud/v1/style/light.json";

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface Props {
  points: GeoPoint[];
  config: MapConfig;
  onSave: (cfg: MapConfig) => void;
}

export default function MapBlockerView({ points, config, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Aktuelle Werte in Refs, damit die Map nicht bei jeder Prop-Änderung neu baut.
  const pointsRef = useRef(points);
  const onSaveRef = useRef(onSave);
  pointsRef.current = points;
  onSaveRef.current = onSave;

  // Karte einmalig aufbauen.
  useEffect(() => {
    if (!containerRef.current) return;
    const hasSaved =
      typeof config.centerLng === "number" &&
      typeof config.centerLat === "number";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: IMMICH_MAP_STYLE,
      center: hasSaved
        ? [config.centerLng as number, config.centerLat as number]
        : [10, 51],
      zoom: hasSaved ? (config.zoom ?? 4) : 3,
      attributionControl: false,
      // preserveDrawingBuffer nötig für den PDF-Schnappschuss (canvas.toDataURL).
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    const addMarkers = () => {
      const pts = pointsRef.current;
      for (const p of pts) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:12px;height:12px;border-radius:50%;background:#e24b4a;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5)";
        new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
      }
      // Ohne gespeicherten Ausschnitt automatisch auf die Punkte zoomen.
      if (!hasSaved && pts.length > 0) {
        if (pts.length === 1) {
          map.setCenter([pts[0].lng, pts[0].lat]);
          map.setZoom(11);
        } else {
          const b = new maplibregl.LngLatBounds();
          pts.forEach((p) => b.extend([p.lng, p.lat]));
          map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 14 });
        }
      }
    };

    map.on("load", addMarkers);

    // Schnappschuss + Ausschnitt speichern (throttled), sobald die Karte ruht.
    const saveView = () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => {
        const c = map.getCenter();
        let snapshot: string | undefined;
        try {
          snapshot = map.getCanvas().toDataURL("image/png");
        } catch {
          snapshot = undefined; // getaintetes Canvas -> ohne Schnappschuss
        }
        onSaveRef.current({
          centerLng: c.lng,
          centerLat: c.lat,
          zoom: map.getZoom(),
          ...(snapshot ? { snapshot } : {}),
        });
      }, 600);
    };
    map.on("idle", saveView);

    // Bei Größenänderung des Leerraums die Karte anpassen.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (snapTimer.current) clearTimeout(snapTimer.current);
      map.remove();
      mapRef.current = null;
    };
    // Absicht: nur einmal aufbauen; Punkte/onSave laufen über Refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      // Karte fängt Zoom/Pan selbst ab; Klicks nicht an den Editor bubblen.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
