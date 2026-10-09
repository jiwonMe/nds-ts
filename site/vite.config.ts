import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildGame } from '../tools/build-script.js';
import { CARTRIDGES } from './cartridges.js';

const packageRoot = resolve(import.meta.dirname, '..');

/** Compiles every cartridge with the ROM toolchain and exposes the results as
 * `virtual:cartridges`. Editing an example reloads the page with fresh bytes. */
function cartridges(): Plugin {
  const id = 'virtual:cartridges';
  return {
    name: 'nds-ts-cartridges',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const output = mkdtempSync(resolve(tmpdir(), 'nds-ts-site-'));
      try {
        const modules = CARTRIDGES.map(({ id: name }) => {
          const entry = resolve(packageRoot, 'examples', name, 'main.ts');
          this.addWatchFile(entry);
          buildGame(entry, resolve(output, name));
          const script = readFileSync(resolve(output, name, 'game.js'), 'utf8');
          const source = readFileSync(entry, 'utf8');
          // `boot` repeats the script as code for pages that cannot evaluate strings.
          return `{ id: ${JSON.stringify(name)}, source: ${JSON.stringify(source)}, script: ${JSON.stringify(script)},
  boot: function (nds, __nds_watchdog) {\n${script}\nreturn game;\n} }`;
        });
        return `export default [\n${modules.join(',\n')}\n];\n`;
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [cartridges()],
  // The editor imports TypeScript lazily; bundling it up front avoids a dev-server reload.
  optimizeDeps: { include: ['typescript'] },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  build: {
    outDir: resolve(packageRoot, 'dist/site'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
