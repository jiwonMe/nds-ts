import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildGame } from './tools/build-script.js';

function compileGameOnChange(): Plugin {
  return {
    name: 'nds-ts-game',
    configureServer(server) {
      const entry = resolve(import.meta.dirname, 'examples/dual-screen/main.ts');
      server.watcher.add(entry);
      server.watcher.on('change', (filename) => {
        if (filename !== entry) return;
        try {
          buildGame(entry);
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          server.ws.send({ type: 'error', err: {
            message: error instanceof Error ? error.message : String(error),
            stack: '',
          } });
        }
      });
    },
  };
}

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [compileGameOnChange()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022' },
});
