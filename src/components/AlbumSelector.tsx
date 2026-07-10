import { useState, useEffect } from "react";
import { getAllAlbums, type AlbumResponseDto } from "@immich/sdk";
import type { ImmichConfig } from "./ConnectionForm";
import { localMediaUrl } from "../utils/remoteStore";
import {
  loadLocalAlbumIndex,
  createLocalAlbum,
  loadLocalAlbum,
  renameLocalAlbum,
  deleteLocalAlbum,
  localAlbumToResponseDto,
  type LocalAlbumIndexEntry,
} from "../utils/localAlbum";

interface AlbumSelectorProps {
  immichConfig: ImmichConfig;
  onSelectAlbum: (album: AlbumResponseDto) => void;
  /** Ohne-Immich-Modus: nur lokale Alben, kein Immich-Abruf. */
  localOnly?: boolean;
}

function AlbumSelector({
  immichConfig,
  onSelectAlbum,
  localOnly = false,
}: AlbumSelectorProps) {
  const [albums, setAlbums] = useState<AlbumResponseDto[]>([]);
  const [localAlbums, setLocalAlbums] = useState<LocalAlbumIndexEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anlegen eines lokalen Albums
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // Umbenennen/Löschen lokaler Alben
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadAlbums();
  }, []);

  const reloadLocal = async () => {
    const localIndex = await loadLocalAlbumIndex();
    localIndex.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setLocalAlbums(localIndex);
  };

  const loadAlbums = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Ohne-Immich-Modus: nur lokale Alben laden, Immich-Abruf überspringen.
      if (localOnly) {
        setAlbums([]);
        await reloadLocal();
        return;
      }

      // Immich-Alben (eigene + geteilte) und lokale Alben parallel laden.
      const [ownedAlbums, sharedAlbums, localIndex] = await Promise.all([
        getAllAlbums({}),
        getAllAlbums({ shared: true }),
        loadLocalAlbumIndex(),
      ]);

      // Combine and deduplicate by album ID using Map
      const allAlbums = [...ownedAlbums, ...sharedAlbums];
      const uniqueAlbums = Array.from(
        new Map(allAlbums.map((album) => [album.id, album])).values(),
      );

      // Sort by most recent asset
      uniqueAlbums.sort((a, b) => {
        if (!a.endDate) {
          return -1;
        }
        if (!b.endDate) {
          return 1;
        }
        return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
      });

      setAlbums(uniqueAlbums);
      // Neueste lokale Alben zuerst
      localIndex.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setLocalAlbums(localIndex);
    } catch (err) {
      const error = err as any;
      let errorMessage = error.message || "Alben konnten nicht geladen werden";

      // Check if it's a 401 Unauthorized error
      if (
        error.status === 401 ||
        errorMessage.includes("401") ||
        errorMessage.includes("Unauthorized")
      ) {
        errorMessage = `Authentifizierung fehlgeschlagen: ${errorMessage}\n\nDein API-Schlüssel wurde womöglich widerrufen oder ist abgelaufen. Bitte mit einem gültigen Schlüssel neu verbinden.`;
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateLocal = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const album = await createLocalAlbum(newName);
      onSelectAlbum(localAlbumToResponseDto(album));
    } catch (e) {
      console.error("Lokales Album konnte nicht angelegt werden:", e);
      setError("Lokales Album konnte nicht angelegt werden.");
    } finally {
      setCreating(false);
      setShowCreate(false);
      setNewName("");
    }
  };

  const handleOpenLocal = async (id: string) => {
    const album = await loadLocalAlbum(id);
    if (album) onSelectAlbum(localAlbumToResponseDto(album));
  };

  const startRename = (entry: LocalAlbumIndexEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  };

  const saveRename = async (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    setBusyId(id);
    try {
      await renameLocalAlbum(id, name);
      await reloadLocal();
    } catch (e) {
      console.error("Umbenennen fehlgeschlagen:", e);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLocal = async (entry: LocalAlbumIndexEntry) => {
    if (
      !window.confirm(
        `Album „${entry.name}" mit ${entry.count} ${entry.count === 1 ? "Foto" : "Fotos"} wirklich löschen? Die Fotos werden dabei aus dem Speicher entfernt.`,
      )
    )
      return;
    setBusyId(entry.id);
    try {
      await deleteLocalAlbum(entry.id);
      await reloadLocal();
    } catch (e) {
      console.error("Löschen fehlgeschlagen:", e);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-stone-200 border-t-primary-600"></div>
        <p className="mt-4 text-stone-600">Alben werden geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800 whitespace-pre-line">{error}</p>
          <button
            onClick={loadAlbums}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm transition-colors shadow-sm font-medium"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  const totalCount = albums.length + localAlbums.length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Album auswählen</h2>
          <p className="text-stone-600 mt-1">
            {totalCount === 0
              ? localOnly
                ? "Noch keine Alben – lege dein erstes lokales Album an."
                : "Noch keine Alben – lege ein lokales Album an oder verbinde ein Immich-Album."
              : `Wähle ein Album für dein Fotobuch (${totalCount} ${totalCount === 1 ? "Album" : "Alben"})`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Neues Album
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[12rem]">
            <label className="mb-1 block text-sm font-medium text-stone-700">
              Name des neuen (lokalen) Albums
            </label>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateLocal();
              }}
              placeholder="z. B. Urlaub 2026"
              className="w-full rounded-md border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="mt-1 text-xs text-stone-500">
              Fotos lädst du danach direkt im Editor hoch – unabhängig von Immich.
            </p>
          </div>
          <button
            onClick={handleCreateLocal}
            disabled={creating}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-60"
          >
            {creating ? "Wird angelegt…" : "Anlegen & öffnen"}
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setNewName("");
            }}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
          >
            Abbrechen
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Lokale Alben zuerst */}
        {localAlbums.map((la) => (
          <div
            key={la.id}
            className={`group relative flex flex-col bg-white rounded-xl border border-stone-200/80 shadow-sm transition-all duration-200 overflow-hidden ${
              renamingId === la.id
                ? "ring-2 ring-primary-500"
                : "hover:shadow-md hover:-translate-y-0.5 hover:border-primary-200"
            } ${busyId === la.id ? "opacity-60" : ""}`}
          >
            <button
              type="button"
              onClick={() => handleOpenLocal(la.id)}
              disabled={renamingId === la.id || busyId === la.id}
              className="flex flex-col text-left focus:outline-none"
            >
              <div className="relative h-48 bg-stone-200 overflow-hidden">
                {la.coverId ? (
                  <img
                    src={localMediaUrl(la.id, la.coverId)}
                    alt={la.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-stone-400">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-primary-600/90 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
                  Lokal
                </span>
              </div>
              <div className="p-4">
                {renamingId === la.id ? null : (
                  <>
                    <h3 className="font-semibold text-stone-900 truncate">
                      {la.name}
                    </h3>
                    <p className="text-sm text-stone-500 mt-1">
                      {la.count} {la.count === 1 ? "Foto" : "Fotos"}
                    </p>
                  </>
                )}
              </div>
            </button>

            {/* Inline-Umbenennen */}
            {renamingId === la.id && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-white/95 p-3 backdrop-blur">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(la.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveRename(la.id)}
                    className="flex-1 rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700"
                  >
                    Speichern
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            {/* Hover-Aktionen: Umbenennen / Löschen */}
            {renamingId !== la.id && (
              <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => startRename(la)}
                  title="Umbenennen"
                  aria-label="Umbenennen"
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-stone-600 shadow-sm hover:bg-white hover:text-stone-900"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteLocal(la)}
                  title="Löschen"
                  aria-label="Löschen"
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-red-600 shadow-sm hover:bg-red-600 hover:text-white"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Immich-Alben */}
        {albums.map((album) => (
          <button
            key={album.id}
            onClick={() => onSelectAlbum(album)}
            className="group flex flex-col text-left bg-white rounded-xl border border-stone-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 transition-all duration-200 overflow-hidden"
          >
            {album.albumThumbnailAssetId ? (
              <div className="h-48 bg-stone-200 relative overflow-hidden">
                <img
                  src={`${immichConfig.baseUrl}/assets/${album.albumThumbnailAssetId}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`}
                  alt={album.albumName}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                />
              </div>
            ) : (
              <div className="h-48 bg-stone-200 flex items-center justify-center">
                <svg
                  className="w-12 h-12 text-stone-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            )}
            <div className="p-4">
              <h3 className="font-semibold text-stone-900 truncate">
                {album.albumName}
              </h3>
              <p className="text-sm text-stone-500 mt-1">
                {album.assetCount} {album.assetCount === 1 ? "Foto" : "Fotos"}
              </p>
              {album.description && (
                <p className="text-sm text-stone-600 mt-2 line-clamp-2">
                  {album.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default AlbumSelector;
