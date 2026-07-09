/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMMICH_PROXY_TARGET?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Laufzeit-Konfiguration aus /config.js (vom Container erzeugt). */
  __IMMICHBOOK_CONFIG__?: { apiKey?: string };
}
