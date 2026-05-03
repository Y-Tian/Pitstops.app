/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEADERBOARD_URL?: string;
  readonly VITE_METADATA_URL?: string;
  readonly VITE_ANALYTICS_URL?: string;
  readonly VITE_DRIVERS_URL?: string;
  readonly VITE_REFRESH_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
