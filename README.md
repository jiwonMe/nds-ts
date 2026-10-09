# nds-ts

Write a small Nintendo DS game in **TypeScript**, preview the same compiled game in a
browser, and build an actual **`.nds` ROM** with BlocksDS.

An MIT-licensed **v0.1 homebrew engine prototype** for small dual-screen games.
Game logic, a browser preview, and a native DS runtime live in one independent
source tree.

## Quick start

Requirements: Node.js 22.12+ and npm. ROM builds additionally require Docker.
The Docker image is pinned by digest. Docker may download it on the first build;
compilation inside the container uses no network.

```sh
git clone https://github.com/jiwonMe/nds-ts.git
cd nds-ts
npm ci
npm run dev          # Browser preview, http://localhost:5174
npm run build        # Actual DS ROM: build/nds-ts-demo.nds
```

Change `examples/dual-screen/main.ts` and rebuild. The game's movement, gravity,
jump, touch behavior, palette changes, and sound decisions are all in that TS file.
No C++ game implementation needs to be edited.

Controls: D-pad / keyboard arrows to move, A / Space / Z to jump, B / X to change the
accent, and the bottom touchscreen / pointer to teleport. Browser audio starts
after **Enable sound** is pressed. The ROM plays sound through DS hardware.

Load the ROM with a DS emulator or a compatible homebrew launcher/flashcart.
Physical DS hardware must be tested separately from emulator verification.

## How it works

```text
TypeScript game + SDK declarations
                 |
        typecheck + ES5 compilation
                 |
          gen/game.js (same bytes)
           /                   \
 browser API adapter       embedded C byte array
 Canvas + WebAudio              |
                         Duktape + native API
                         libnds / ARM9 + ARM7
                                |
                         build/nds-ts-demo.nds
```

The TypeScript compiler runs on the development computer. The DS executes the
generated ES5 JavaScript in Duktape. Screen drawing, buttons, touchscreen sampling,
and audio output are native C++/libnds operations. Duktape is included in the source
tree, with its own license and a documented platform configuration.

## Write a game

The initial game format is a **single global script** defining `game`. A minimal
example is:

```ts
var x = 120;

var game: NDSGame = {
  update: function () {
    x = Math.max(0, Math.min(240, x + nds.input.dx() * 2));
    if (nds.input.hit('a')) nds.audio.tone(660, 6);
  },
  draw: function () {
    nds.top.clear(0xffffff);
    nds.top.sprite('orb', x, 138);
    nds.bottom.clear(0xffffff);
    nds.bottom.text('HELLO FROM TYPESCRIPT', 12, 12, 0x202020);
  }
};
```

The compiler includes `sdk/index.d.ts` automatically. For editor completion in the
example folder, the provided demo also has a reference to that declaration file.
`init()` is optional; `update()` and `draw()` are required. Callbacks receive
`this = game` on both targets.

To use another entry file, run these commands from this directory:

```sh
npm run build:script -- examples/my-game/main.ts  # JS and native headers only
npm run build -- examples/my-game/main.ts         # Compile and build ROM
```

The browser previews the last generated `gen/game.js`. Rebuild the script after
editing TS; Vite reloads that generated file. `npm run dev` compiles the default
example before starting the preview.

## API

The complete declarations are in `sdk/index.d.ts`.

| API | Behavior |
| --- | --- |
| `nds.width`, `nds.height` | 256 and 192, for each display |
| `nds.top`, `nds.bottom` | `clear(color)`, `rect(x,y,w,h,color)`, `text(value,x,y,color)`, `sprite(name,x,y)` |
| `nds.input.down/hit/up(button)` | Held, pressed this tick, released this tick |
| `nds.input.dx()/dy()` | Direction in -1, 0, 1; opposite buttons cancel |
| `nds.touch` | `x`, `y`, `down`, `pressed`, `released`; bottom-screen coordinates |
| `nds.audio.tone(hz, frames, volume?)` | 40–4000 Hz, 1–600 whole ticks, volume 0–1; default 0.3 |
| `nds.frame` | Simulation tick counter, beginning at 0 |
| `nds.stats` | Native JS heap/current peak bytes and previous update/draw microseconds |

Button names: `up`, `down`, `left`, `right`, `a`, `b`, `x`, `y`, `l`, `r`, `start`,
`select`. Colors are integer `0xRRGGBB` values. Drawing coordinates are rounded to
the nearest pixel and clipped. Negative/zero rectangle dimensions draw nothing.
Text uses an original 3×5 font: printable ASCII plus newline, uppercase rendering,
4-pixel character advance, and 7-pixel line advance. Text is limited to 1024 bytes
per call. The only bundled sprite is the original 16×16 `orb`, positioned by its
top-left corner. Sprite corners are transparent.

Browser heap metrics are reported as zero because browsers do not expose the
Duktape allocator. Browser update/draw timings describe the browser adapter, not
DS CPU costs. Tone generation is a single voice on both targets.

## More examples

`examples/` holds four games. `dual-screen` is the default demo measured below; the
others use the same API harder:

| Example | What it shows |
| --- | --- |
| `hinge-breakout` | Bricks on the top screen, the paddle on the bottom, and a ball that crosses the hinge gap. |
| `touch-synth` | A 16-step square-wave sequencer played from the touchscreen. |
| `pixel-paint` | 16×12 pixel art drawn with the stylus and framed on the top screen. |

Build any of them into a ROM with `npm run build -- examples/<name>/main.ts`. So far only
`dual-screen` has emulator measurements. `npm test` plays every example for a minute of
random input and fails if a frame exceeds the 1500-quad top-screen budget.

## Project site

`site/` is the project's landing page. It runs every example on a browser console that
follows the native renderer's rules (RGB15 colors, the 3×5 font, the 1500-quad top-screen
budget and the script error screen). Visitors can edit a game and recompile it in the
browser under the same ES5 checks as `tools/build-script.ts`.

```sh
npm run dev:site      # http://localhost:5175
npm run build:site    # dist/site
```

## Verification

```sh
npm run check         # Tooling/SDK typecheck and ES5 game compilation
npm test              # Compiler + actual compiled game behavior
npm run test:tools     # ROM measurement/header/audio checks; Python + Pillow
npm run test:native    # Real Duktape/native renderer; system C/C++ compiler
npm run build:web     # Production browser preview
```

Native host tests use AddressSanitizer and UndefinedBehaviorSanitizer by default;
use `SANITIZE=0 npm run test:native` when the local compiler lacks sanitizer support.
They exercise the actual compiled demo, rendering/input/audio callbacks, script
exceptions, malformed SDK state, throwing getters, infinite-loop watchdogs, and
heap exhaustion.

For end-to-end DS verification, install Pillow and supply an already installed
melonDS-compatible libretro core. This tool downloads no emulator or firmware:

```sh
python3 -m pip install Pillow
python3 -B tools/verify-rom.py build/nds-ts-demo.nds --core /path/to/melonds_libretro.so
```

The check validates the ROM header, measures movement and jumping from captured
pixels, checks touchscreen relocation and non-silent audio, and reads the runtime
metrics printed on the bottom screen. Evidence is saved in `captures/demo/`.

The included demo was verified with the melonDS 0.9.3 libretro core:

| Measurement | Result |
| --- | --- |
| Observed game rate | 59.9 ticks/second |
| JS heap shown by the HUD | About 82 KiB |
| Update / draw time | About 0.91 / 12.38 ms |
| Jump tone | 660.5 Hz (requested 660 Hz) |
| Touch relocation | Passed; visible within 3 emulated frames |

The upper GPU display is pipelined, so captured pixels trail the current game
state. ROM checks allow this presentation delay while requiring the simulation
to advance at the core's approximately 60 Hz rate. These results describe this
demo in an emulator; physical hardware has not yet been verified.

A second ROM changed only the demo's TypeScript movement multiplier from 2 to 3.
Holding RIGHT for 30 ticks then moved the orb 90 pixels instead of 60. Both ROMs
passed the same input, touch, audio, and frame-rate checks, and all native source
SHA-256 hashes remained unchanged.

## Boundaries of v0.1

- This is a small 2D engine prototype. The top screen uses opaque hardware quads
  and the bottom screen uses an RGB15 bitmap. The top renderer stops with a script
  diagnostic if a frame exceeds 1500 quads (font and sprite spans also count);
  it does not yet expose hardware sprites, tilemaps, imported PNGs, a physics API,
  a scene manager, save data, music sequencing, or networking.
- Game code is one global TS script. Imports, exports, extra source references,
  browser/Node APIs, and ES2015-only libraries such as `Map`, `Set`, and `Promise`
  are rejected. New TS syntax that can compile to ES5 may be used.
- The native JS heap has a 512 KiB budget including allocation headers. This metric
  excludes code, native buffers, ARM7 memory, stacks, and VRAM. A script error stops
  gameplay and displays a diagnostic. Bootstrap and callback watchdogs are 500 ms
  and 100 ms, checked periodically by the interpreter.
- Each native loop advances one game tick. A heavy game that misses VBlank slows
  down; there is no promise of 60 fps for arbitrary scripts. The included demo is
  measured by the ROM integration check.
- JS number calculations use software floating point on DS. Move expensive loops
  into native API operations as the engine grows.

## Publishable source bundle

```sh
npm run package:source  # dist/nds-ts-source.tar.gz
```

The export contains only this package's source, license, dependencies lockfile,
and a SHA-256 file manifest. It refuses symlinks and unknown file types, and excludes
builds, screenshots, caches, original game files, and Git history. Extract it into
an empty directory to begin an independent repository. `private: true` prevents
accidental npm publication; it does not limit use under the MIT source license.


## License

Engine code, demo artwork, and the bitmap font: MIT, see `LICENSE`.
Duktape 2.7.0: MIT, see `vendor/duktape/LICENSE.txt` and `AUTHORS.rst`.
BlocksDS/libnds and the build image remain separate build dependencies under their
respective licenses. This project is an independent homebrew tool and is not
affiliated with Nintendo.
