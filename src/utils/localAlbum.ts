/**
 * Lokale Alben – Fotobücher aus selbst hochgeladenen Bildern, unabhängig von
 * Immich. Die Fotos liegen als echte Dateien im zentralen Store-Volume
 * (`/store/media/<albumId>/<mediaId>.jpg`), das Album-Manifest als JSON
 * (`localalbum-<albumId>.json`), ein Index aller lokalen Alben in
 * `local-albums.json`. So bleiben lokale Alben – wie Immich-Alben – automatisch
 * geräteübergreifend synchron.
 *
 * Kerntrick für die volle Editor-Parität: Jedes hochgeladene Foto wird zu einem
 * echten `AssetResponseDto` (Pseudo-Asset) mit id/exifInfo/Maßen. Dadurch laufen
 * Layout, Crop, Bildunterschriften, Reihenfolge, Leerräume, Titelblatt und
 * PDF-Export unverändert – nur die Bildquelle wird abgezweigt (siehe
 * `isLocalAlbumId`/`localMediaUrl`).
 */
import type { AssetResponseDto, AlbumResponseDto } from "@immich/sdk";
import { randomId } from "./id";
import {
  fetchRemoteConfig,
  putRemoteConfigNow,
  putRemoteMedia,
  deleteRemoteMedia,
  deleteRemoteConfig,
} from "./remoteStore";

const LOCAL_ALBUM_ID_PREFIX = "local-";
const LOCAL_INDEX_NAME = "local-albums";
const localAlbumStoreName = (id: string) => `localalbum-${id}`;

export function isLocalAlbumId(albumId: string): boolean {
  return albumId.startsWith(LOCAL_ALBUM_ID_PREFIX);
}

/** Ein Foto eines lokalen Albums (Persistenz-Form im Manifest). */
export interface LocalPhoto {
  id: string; // mediaId (Dateiname ohne Endung)
  fileName: string;
  width: number;
  height: number;
  createdAt: string; // ISO
}

export interface LocalAlbum {
  id: string;
  name: string;
  createdAt: string;
  photos: LocalPhoto[];
}

export interface LocalAlbumIndexEntry {
  id: string;
  name: string;
  createdAt: string;
  count: number;
  coverId?: string; // mediaId des Titelfotos für die Vorschau
}

/* ------------------------------------------------------------------ */
/* Pseudo-Assets: LocalPhoto -> AssetResponseDto                        */
/* ------------------------------------------------------------------ */

/**
 * Baut aus einem LocalPhoto ein `AssetResponseDto`, wie es der Editor erwartet.
 * Nur die tatsächlich genutzten Felder werden gefüllt; der Rest wird mit
 * neutralen Defaults belegt und das Objekt auf den SDK-Typ gecastet.
 */
export function localPhotoToAsset(photo: LocalPhoto): AssetResponseDto {
  return {
    id: photo.id,
    type: "IMAGE",
    originalFileName: photo.fileName,
    fileCreatedAt: photo.createdAt,
    fileModifiedAt: photo.createdAt,
    localDateTime: photo.createdAt,
    updatedAt: photo.createdAt,
    exifInfo: {
      exifImageWidth: photo.width,
      exifImageHeight: photo.height,
      // Wir zeichnen beim Upload auf ein Canvas (EXIF-Orientierung bereits
      // angewandt) -> Maße sind aufrecht, keine "6"-Sonderbehandlung nötig.
      orientation: "1",
    },
  } as unknown as AssetResponseDto;
}

export function localAlbumAssets(album: LocalAlbum): AssetResponseDto[] {
  return album.photos.map(localPhotoToAsset);
}

/**
 * Baut aus einem lokalen Album ein synthetisches `AlbumResponseDto`, damit der
 * bestehende Editor (PhotoGrid) es wie ein Immich-Album konsumieren kann.
 */
export function localAlbumToResponseDto(album: LocalAlbum): AlbumResponseDto {
  const assets = localAlbumAssets(album);
  return {
    id: album.id,
    albumName: album.name,
    description: "",
    assets,
    assetCount: assets.length,
    createdAt: album.createdAt,
    updatedAt: album.createdAt,
    ownerId: "local",
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
    albumThumbnailAssetId: album.photos[0]?.id ?? null,
  } as unknown as AlbumResponseDto;
}

/* ------------------------------------------------------------------ */
/* Bildverarbeitung: File -> herunterskalierter JPEG-Blob              */
/* ------------------------------------------------------------------ */

/**
 * Skaliert ein Bild auf max. `maxEdge` px lange Kante herunter und liefert einen
 * JPEG-Blob plus die (aufrechten) Maße. Größe druckfreundlich (Standard 2400 px).
 */
export async function fileToStoredJpeg(
  file: File,
  maxEdge = 2400,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number } | null> {
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
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
  if (!blob) return null;
  return { blob, width: w, height: h };
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

export async function loadLocalAlbumIndex(): Promise<LocalAlbumIndexEntry[]> {
  const raw = await fetchRemoteConfig(LOCAL_INDEX_NAME);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as LocalAlbumIndexEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveLocalAlbumIndex(
  entries: LocalAlbumIndexEntry[],
): Promise<void> {
  await putRemoteConfigNow(LOCAL_INDEX_NAME, JSON.stringify(entries));
}

function indexEntryFor(album: LocalAlbum): LocalAlbumIndexEntry {
  return {
    id: album.id,
    name: album.name,
    createdAt: album.createdAt,
    count: album.photos.length,
    coverId: album.photos[0]?.id,
  };
}

async function upsertIndexEntry(album: LocalAlbum): Promise<void> {
  const index = await loadLocalAlbumIndex();
  const next = index.filter((e) => e.id !== album.id);
  next.push(indexEntryFor(album));
  await saveLocalAlbumIndex(next);
}

/* ------------------------------------------------------------------ */
/* Album-Manifest                                                      */
/* ------------------------------------------------------------------ */

export async function loadLocalAlbum(id: string): Promise<LocalAlbum | null> {
  const raw = await fetchRemoteConfig(localAlbumStoreName(id));
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as LocalAlbum;
    if (!a || a.id !== id || !Array.isArray(a.photos)) return null;
    return a;
  } catch {
    return null;
  }
}

async function saveLocalAlbum(album: LocalAlbum): Promise<boolean> {
  const ok = await putRemoteConfigNow(
    localAlbumStoreName(album.id),
    JSON.stringify(album),
  );
  if (ok) await upsertIndexEntry(album);
  return ok;
}

export async function createLocalAlbum(name: string): Promise<LocalAlbum> {
  const album: LocalAlbum = {
    id: randomId(LOCAL_ALBUM_ID_PREFIX).replace(/[^a-zA-Z0-9-]/g, ""),
    name: name.trim() || "Neues Album",
    createdAt: new Date().toISOString(),
    photos: [],
  };
  await saveLocalAlbum(album);
  return album;
}

export async function renameLocalAlbum(
  id: string,
  name: string,
): Promise<LocalAlbum | null> {
  const album = await loadLocalAlbum(id);
  if (!album) return null;
  album.name = name.trim() || album.name;
  await saveLocalAlbum(album);
  return album;
}

export async function deleteLocalAlbum(id: string): Promise<void> {
  const album = await loadLocalAlbum(id);
  if (album) {
    for (const p of album.photos) await deleteRemoteMedia(id, p.id);
  }
  await deleteRemoteConfig(localAlbumStoreName(id));
  const index = await loadLocalAlbumIndex();
  await saveLocalAlbumIndex(index.filter((e) => e.id !== id));
}

/**
 * Verarbeitet Dateien, lädt sie als JPEG in den Store und hängt sie ans Album.
 * Gibt das aktualisierte Album zurück. `onProgress` meldet fertige/gesamt.
 */
export async function addPhotosToLocalAlbum(
  album: LocalAlbum,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<LocalAlbum> {
  const images = files.filter((f) => f.type.startsWith("image/"));
  let done = 0;
  for (const file of images) {
    try {
      const stored = await fileToStoredJpeg(file);
      if (!stored) continue;
      const mediaId = randomId("img").replace(/[^a-zA-Z0-9-]/g, "");
      await putRemoteMedia(album.id, mediaId, stored.blob);
      album.photos.push({
        id: mediaId,
        fileName: file.name,
        width: stored.width,
        height: stored.height,
        createdAt: new Date(file.lastModified || Date.now()).toISOString(),
      });
    } catch (e) {
      console.error("Foto-Upload fehlgeschlagen:", file.name, e);
    } finally {
      done += 1;
      onProgress?.(done, images.length);
    }
  }
  await saveLocalAlbum(album);
  return album;
}

/**
 * Übernimmt ein bereits im Browser vorhandenes Bild (Data-URL) als echtes
 * Album-Foto. Genutzt beim "Fixieren" eines frei platzierten/gedroppten Bildes.
 */
export async function addDataUrlToLocalAlbum(
  album: LocalAlbum,
  dataUrl: string,
  fileName = "bild.jpg",
): Promise<LocalAlbum> {
  const blob = await (await fetch(dataUrl)).blob();
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.width, h: i.height });
    i.onerror = () => resolve({ w: 1, h: 1 });
    i.src = dataUrl;
  });
  const mediaId = randomId("img").replace(/[^a-zA-Z0-9-]/g, "");
  await putRemoteMedia(album.id, mediaId, blob);
  album.photos.push({
    id: mediaId,
    fileName,
    width: dims.w,
    height: dims.h,
    createdAt: new Date().toISOString(),
  });
  await saveLocalAlbum(album);
  return album;
}

/** Entfernt ein Foto (Datei + Manifest-Eintrag). */
export async function removePhotoFromLocalAlbum(
  album: LocalAlbum,
  photoId: string,
): Promise<LocalAlbum> {
  album.photos = album.photos.filter((p) => p.id !== photoId);
  await deleteRemoteMedia(album.id, photoId);
  await saveLocalAlbum(album);
  return album;
}

/* ------------------------------------------------------------------ */
/* Import aus Immich                                                    */
/* ------------------------------------------------------------------ */

/** Minimale Beschreibung eines Immich-Fotos für den Import. */
export interface ImmichAssetRef {
  id: string;
  fileName?: string;
  createdAt?: string;
}

/**
 * Übernimmt einen bereits geladenen Bild-Blob als Album-Foto-Datei.
 * Ein JPEG in passender Größe wird UNVERÄNDERT gespeichert (keine erneute
 * Codierung = kein Qualitätsverlust); alles andere wird über das Canvas
 * herunterskaliert und nach JPEG gewandelt.
 */
async function blobToStoredJpeg(
  blob: Blob,
  maxEdge = 2400,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
      i.src = url;
    });
    const longEdge = Math.max(img.width, img.height);
    if (blob.type === "image/jpeg" && longEdge <= maxEdge) {
      return { blob, width: img.width, height: img.height };
    }
    const scale = Math.min(1, maxEdge / longEdge);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    if (!out) return null;
    return { blob: out, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Kopiert Fotos aus einem Immich-Album in ein lokales Album: Das Bild wird von
 * Immich geladen und als eigene Datei im Store abgelegt. Danach ist das Foto
 * ein vollwertiges lokales Album-Foto – unabhängig davon, ob Immich später noch
 * erreichbar ist oder das Foto dort gelöscht wird.
 *
 * `imageUrlFor` liefert die (same-origin) Bild-URL zu einer Immich-Asset-Id;
 * so bleibt dieses Modul frei von Verbindungs-/Schlüssel-Details.
 */
export async function addImmichAssetsToLocalAlbum(
  album: LocalAlbum,
  assets: ImmichAssetRef[],
  imageUrlFor: (assetId: string) => string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ album: LocalAlbum; added: number; failed: number }> {
  let done = 0;
  let added = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const res = await fetch(imageUrlFor(asset.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stored = await blobToStoredJpeg(await res.blob());
      if (!stored) throw new Error("Bild nicht verarbeitbar");
      const mediaId = randomId("img").replace(/[^a-zA-Z0-9-]/g, "");
      await putRemoteMedia(album.id, mediaId, stored.blob);
      album.photos.push({
        id: mediaId,
        fileName: asset.fileName || `${asset.id}.jpg`,
        width: stored.width,
        height: stored.height,
        createdAt: asset.createdAt || new Date().toISOString(),
      });
      added += 1;
    } catch (e) {
      failed += 1;
      console.error("Immich-Import fehlgeschlagen:", asset.id, e);
    } finally {
      done += 1;
      onProgress?.(done, assets.length);
    }
  }
  if (added > 0) await saveLocalAlbum(album);
  return { album, added, failed };
}
