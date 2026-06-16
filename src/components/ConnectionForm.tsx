import { useState } from "react";
import { init, getAllAlbums } from "@immich/sdk";

export interface ImmichConfig {
  serverUrl: string;
  apiKey: string;
  baseUrl: string;
}

interface ConnectionFormProps {
  onConnect: (config: ImmichConfig) => void;
}

function ConnectionForm({ onConnect }: ConnectionFormProps) {
  const proxyTarget = import.meta.env.VITE_IMMICH_PROXY_TARGET;
  const [serverUrl, setServerUrl] = useState(proxyTarget || "");
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      // If proxy is configured, use proxy path. Otherwise, use full URL
      const baseUrl = proxyTarget ? "/api" : serverUrl.replace(/\/$/, "") + "/api";

      // Initialize the SDK
      init({ baseUrl, apiKey });

      // Validate connection by getting albums
      await getAllAlbums({});

      // Store config in state and localStorage
      const config: ImmichConfig = { serverUrl, apiKey, baseUrl };
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

  const handleUseDemoServer = () => {
    setServerUrl("https://demo.immich.app");
    setApiKey(import.meta.env.VITE_DEMO_API_KEY || "");
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Mit Immich verbinden</h2>
        <p className="text-sm text-stone-600 mb-6">
          Gib Server-URL und API-Schlüssel ein, um zu starten.
        </p>
        {proxyTarget && (
          <div className="mb-4 p-3 bg-primary-50 border border-primary-200 rounded-md">
            <p className="text-xs text-primary-800">
              <strong>Dev-Modus:</strong> Proxy auf {proxyTarget}
            </p>
          </div>
        )}

        {!import.meta.env.DEV &&
          typeof window !== "undefined" &&
          !window.location.hostname.match(
            /^(localhost|127\.0\.0\.1|.*\.local)$/,
          ) && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded-md">
              <p className="text-xs text-yellow-900 font-semibold mb-2">
                ⚠️ Sicherheitshinweis
              </p>
              <p className="text-xs text-yellow-800">
                Du nutzt eine fremdgehostete Instanz. Dein API-Schlüssel könnte
                von <strong>{window.location.hostname}</strong> aufgezeichnet
                werden. Fahre nur fort, wenn du diesem Anbieter vertraust! Wer
                das Hosting kontrolliert, kann über deinen Schlüssel potenziell
                auf alle deine Fotos zugreifen. Für maximale Sicherheit hoste
                selbst auf derselben Domain wie dein Immich-Server.
              </p>
            </div>
          )}

        {import.meta.env.VITE_DEMO_API_KEY && (
          <div className="mb-4 p-4 bg-primary-50 border border-primary-200 rounded-md">
            <p className="text-xs text-primary-900 font-semibold mb-2">
              💡 Demo ausprobieren
            </p>
            <p className="text-xs text-primary-800 mb-3">
              Immich Book ausprobieren, ohne einen eigenen Server einzurichten?
              Nutze die öffentliche Instanz <strong>demo.immich.app</strong>, um
              alle Funktionen mit Beispielfotos zu testen.
            </p>
            <button
              type="button"
              onClick={handleUseDemoServer}
              className="text-xs px-3 py-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors font-medium"
            >
              Demo-Server verwenden
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="serverUrl"
              className="block text-sm font-medium text-stone-700 mb-1"
            >
              Server-URL
            </label>
            <input
              type="url"
              id="serverUrl"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://immich.example.com"
              required={!proxyTarget}
              disabled={!!proxyTarget}
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
            />
          </div>

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
      </div>
    </div>
  );
}

export default ConnectionForm;
