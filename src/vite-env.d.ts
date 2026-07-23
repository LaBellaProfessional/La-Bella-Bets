/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

// Versão do build, injetada via `define` no vite.config.ts (hash curto do commit + data).
declare const __APP_VERSION__: string;
declare const __APP_BUILT__: string;
