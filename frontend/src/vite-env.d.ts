/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server origin, when it isn't the origin serving the app. */
  readonly VITE_BACKEND_URL?: string;
}
