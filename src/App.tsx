import { useState, useEffect } from "react";
import { init, getAlbumInfo, type AlbumResponseDto } from "@immich/sdk";
import ConnectionForm, { type ImmichConfig } from "./components/ConnectionForm";
import AlbumSelector from "./components/AlbumSelector";
import PhotoGrid from "./components/PhotoGrid";
import { hydrateAlbumFromRemote } from "./utils/albumConfig";
import {
  isLocalAlbumId,
  loadLocalAlbum,
  localAlbumToResponseDto,
} from "./utils/localAlbum";

// Platzhalter-Konfig für den Ohne-Immich-Modus: der Editor/AlbumSelector braucht
// eine ImmichConfig-Instanz, für lokale Alben werden apiKey/baseUrl aber nie genutzt.
const LOCAL_ONLY_CONFIG: ImmichConfig = {
  serverUrl: "",
  apiKey: "",
  baseUrl: "/api",
};
const LOCAL_ONLY_KEY = "immich-book-local-only";

function App() {
  const [immichConfig, setImmichConfig] = useState<ImmichConfig | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumResponseDto | null>(
    null,
  );
  const [isLoadingAlbum, setIsLoadingAlbum] = useState(false);
  // Album-ID, deren zentraler Bearbeitungsstand bereits in den lokalen Cache
  // gezogen wurde. Bis dahin zeigt der Editor einen Ladehinweis, damit er nicht
  // kurz den alten lokalen Stand rendert und dann überschreibt.
  const [hydratedAlbumId, setHydratedAlbumId] = useState<string | null>(null);

  // Check for reset parameter in URL to clear localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "true") {
      console.log("Clearing all localStorage data...");
      localStorage.clear();
      // Remove the parameter from URL, preserve hash
      const hash = window.location.hash;
      window.history.replaceState({}, "", window.location.pathname + hash);
      window.location.reload();
    }
  }, []);

  // Auto-Connect beim Start: Der API-Schlüssel kann zentral vom Server geliefert
  // werden (window.__IMMICHBOOK_CONFIG__.apiKey aus /config.js) — dann muss KEIN
  // Gerät etwas eingeben. Sonst greift ein pro Gerät gespeicherter Schlüssel.
  // Die Server-Adresse ist immer same-origin ("/api", per nginx-Proxy).
  useEffect(() => {
    const injectedKey = window.__IMMICHBOOK_CONFIG__?.apiKey?.trim();
    let storedKey = "";
    try {
      const saved = localStorage.getItem("immich-config");
      if (saved) storedKey = (JSON.parse(saved)?.apiKey || "").trim();
    } catch {
      localStorage.removeItem("immich-config");
    }
    const apiKey = injectedKey || storedKey;
    if (apiKey) {
      const config: ImmichConfig = { serverUrl: "", apiKey, baseUrl: "/api" };
      init({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      setImmichConfig(config);
    } else if (localStorage.getItem(LOCAL_ONLY_KEY) === "1") {
      // Zuvor „Ohne Immich" gewählt -> ohne Verbindung fortfahren.
      setLocalOnly(true);
      setImmichConfig(LOCAL_ONLY_CONFIG);
    }
  }, []);

  // Load album from URL hash if specified
  useEffect(() => {
    if (!immichConfig) return;

    const loadAlbumFromHash = () => {
      const hash = window.location.hash;

      // Extract album ID from hash like #/albums/<id>
      const albumsMatch = hash.match(/#\/albums\/([^/]+)/);
      const albumId = albumsMatch ? albumsMatch[1] : null;

      if (albumId) {
        // Only load if different from current
        if (!selectedAlbum || selectedAlbum.id !== albumId) {
          setIsLoadingAlbum(true);
          // Lokale Alben aus dem Store-Manifest laden, Immich-Alben per SDK.
          const loader = isLocalAlbumId(albumId)
            ? loadLocalAlbum(albumId).then((la) =>
                la ? localAlbumToResponseDto(la) : Promise.reject(new Error("Lokales Album nicht gefunden")),
              )
            : getAlbumInfo({ id: albumId });
          loader
            .then((album) => {
              setSelectedAlbum(album);
            })
            .catch((err) => {
              console.error("Failed to load album from URL:", err);
              // Clear invalid album ID from hash - go back to album list
              window.location.hash = "";
              setSelectedAlbum(null);
            })
            .finally(() => {
              setIsLoadingAlbum(false);
            });
        }
      } else {
        // No album in hash, clear selection
        if (selectedAlbum) {
          setSelectedAlbum(null);
        }
      }
    };

    // Load on mount
    loadAlbumFromHash();

    // Handle hash changes (browser back/forward, manual hash changes)
    const handleHashChange = () => {
      loadAlbumFromHash();
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [immichConfig]);

  // Beim Öffnen eines Albums zuerst den zentralen Stand in den lokalen Cache
  // ziehen, damit alle Geräte denselben Bearbeitungsstand sehen. Erst danach
  // wird der Editor (der synchron aus dem Cache lädt) freigegeben.
  useEffect(() => {
    if (!selectedAlbum) return;
    const id = selectedAlbum.id;
    let cancelled = false;
    setHydratedAlbumId(null);
    hydrateAlbumFromRemote(id).finally(() => {
      if (!cancelled) setHydratedAlbumId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAlbum]);

  const handleConnect = (config: ImmichConfig) => {
    setImmichConfig(config);
  };

  const handleLocalOnly = () => {
    localStorage.setItem(LOCAL_ONLY_KEY, "1");
    setLocalOnly(true);
    setImmichConfig(LOCAL_ONLY_CONFIG);
  };

  const handleDisconnect = () => {
    setImmichConfig(null);
    setLocalOnly(false);
    setSelectedAlbum(null);
    localStorage.removeItem("immich-config");
    localStorage.removeItem(LOCAL_ONLY_KEY);
    // Clear hash
    window.location.hash = "";
  };

  const handleAlbumSelect = (album: AlbumResponseDto) => {
    setSelectedAlbum(album);
    // Update hash to #/albums/<id>
    window.location.hash = `/albums/${album.id}`;
  };

  const handleBackToAlbums = () => {
    setSelectedAlbum(null);
    // Clear hash to go back to album list
    window.location.hash = "";
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/90 shadow-sm backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/icon.png"
                alt=""
                aria-hidden="true"
                className="h-28 w-28 rounded-2xl sm:h-32 sm:w-32"
              />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  BilderBuch
                </h1>
                <p className="text-sm text-stone-500 sm:text-base">
                  Fotobücher aus deinen Immich-Alben erstellen
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/Faeslich8/immich-book"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-stone-700 hover:text-stone-900 transition-colors"
                title="Quellcode auf GitHub (Fork von ch1bo/immich-book, AGPL-3.0)"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </a>
              {immichConfig && (
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors shadow-sm"
                >
                  Trennen
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!immichConfig ? (
          <ConnectionForm
            onConnect={handleConnect}
            onLocalOnly={handleLocalOnly}
          />
        ) : isLoadingAlbum ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-stone-200 border-t-primary-600"></div>
            <p className="mt-4 text-stone-600">Album wird geladen…</p>
          </div>
        ) : !selectedAlbum ? (
          <AlbumSelector
            immichConfig={immichConfig}
            onSelectAlbum={handleAlbumSelect}
            localOnly={localOnly}
          />
        ) : hydratedAlbumId !== selectedAlbum.id ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-stone-200 border-t-primary-600"></div>
            <p className="mt-4 text-stone-600">
              Bearbeitungsstand wird synchronisiert…
            </p>
          </div>
        ) : (
          <PhotoGrid
            key={selectedAlbum.id}
            immichConfig={immichConfig}
            album={selectedAlbum}
            onBack={handleBackToAlbums}
          />
        )}
      </main>
    </div>
  );
}

export default App;
