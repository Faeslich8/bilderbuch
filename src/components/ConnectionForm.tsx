import { useState } from "react";
import { init, getAllAlbums } from "@immich/sdk";

export interface ImmichConfig {
  serverUrl: string;
  apiKey: string;
  baseUrl: string;
}

interface ConnectionFormProps {
  onConnect: (config: ImmichConfig) => void;
  /** Ohne Immich fortfahren – nur lokale (selbst hochgeladene) Alben nutzen. */
  onLocalOnly: () => void;
}

// Der Immich-Server wird immer same-origin über den nginx-Proxy ("/api")
// angesprochen — dadurch entfällt die Server-Adresse als Eingabe. Wenn im
// Deployment ein zentraler Schlüssel hinterlegt ist (IMMICH_API_KEY), wird
// dieses Formular gar nicht erst angezeigt (siehe App.tsx). Es dient nur noch
// als Fallback, um pro Gerät einen persönlichen API-Schlüssel zu hinterlegen.
function ConnectionForm({ onConnect, onLocalOnly }: ConnectionFormProps) {
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      const baseUrl = "/api";

      // SDK initialisieren und Verbindung durch Album-Abruf validieren
      init({ baseUrl, apiKey });
      await getAllAlbums({});

      // Schlüssel pro Gerät merken
      const config: ImmichConfig = { serverUrl: "", apiKey, baseUrl };
      localStorage.setItem("immich-config", JSON.stringify(config));
      onConnect(config);
    } catch (err) {
      setError(
        (err as Error).message ||
          "Verbindung zum Immich-Server fehlgeschlagen",
      );
      setIsConnecting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Mit Immich verbinden</h2>
        <p className="text-sm text-stone-600 mb-6">
          Gib deinen Immich-API-Schlüssel ein, um zu starten. Der Server ist
          bereits hinterlegt.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              API-Schlüssel
            </label>
            <input
              type="password"
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Dein Immich-API-Schlüssel"
              required
              autoFocus
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="mt-1 text-xs text-stone-500">
              API-Schlüssel in Immich erzeugen: Kontoeinstellungen → API-Schlüssel
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-stone-400 disabled:cursor-not-allowed transition-colors shadow-sm font-medium"
          >
            {isConnecting ? "Verbinden…" : "Verbinden"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-stone-200" />
          <span className="text-xs text-stone-400">oder</span>
          <div className="h-px flex-1 bg-stone-200" />
        </div>

        <button
          type="button"
          onClick={onLocalOnly}
          className="mt-4 w-full rounded-lg border border-stone-300 bg-white px-4 py-2 font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50"
        >
          Ohne Immich starten
        </button>
        <p className="mt-2 text-center text-xs text-stone-500">
          Nur eigene, hochgeladene Alben – ganz ohne Immich-Server.
        </p>
      </div>
    </div>
  );
}

export default ConnectionForm;
