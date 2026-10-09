/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional CDN URL of TypeScript's browser build; see compiler.ts. */
  readonly VITE_TYPESCRIPT_URL?: string;
}

declare module 'virtual:cartridges' {
  const cartridges: {
    id: string;
    /** The example's TypeScript source. */
    source: string;
    /** gen/game.js for this example, byte for byte. */
    script: string;
    boot(nds: NDSRuntime, watchdog: () => void): NDSGame;
  }[];
  export default cartridges;
}
