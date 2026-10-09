import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { after, test } from 'node:test';
import { Framebuffer, TOP_QUAD_LIMIT } from '../sdk/framebuffer.js';
import { buttonName, toneArguments } from '../sdk/runtime-validation.js';
import { buildGame } from '../tools/build-script.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'nds-ts-examples-'));
after(() => rmSync(temporary, { recursive: true, force: true }));

const buttons: NDSButton[] = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];
const examples = readdirSync(path.join(root, 'examples'))
  .filter(name => existsSync(path.join(root, 'examples', name, 'main.ts')))
  .sort();

/** Plays a compiled game with seeded random buttons and stylus strokes. */
function play(script: string, frames: number, seed: number) {
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const top = new Framebuffer(true);
  const bottom = new Framebuffer();
  let held = new Set<NDSButton>();
  let previous = new Set<NDSButton>();
  const touch = { x: 0, y: 0, down: false, pressed: false, released: false };
  const tones: number[][] = [];
  const nds = {
    width: 256, height: 192, frame: 0,
    stats: { heapBytes: 0, heapPeakBytes: 0, updateMicros: 0, drawMicros: 0 },
    input: {
      down: (button: NDSButton) => held.has(buttonName(button)),
      hit: (button: NDSButton) => held.has(buttonName(button)) && !previous.has(button),
      up: (button: NDSButton) => !held.has(buttonName(button)) && previous.has(button),
      dx: () => Number(held.has('right')) - Number(held.has('left')),
      dy: () => Number(held.has('down')) - Number(held.has('up')),
    },
    touch, top, bottom,
    audio: { tone: (frequency: number, length: number, volume?: number) => { tones.push(toneArguments(frequency, length, volume)); } },
  };
  const context = vm.createContext({ nds }) as vm.Context & { game: NDSGame };
  new vm.Script(script, { filename: 'compiled-game.js' }).runInContext(context, { timeout: 2000 });
  context.game.init?.();
  let peakQuads = 0;
  for (let frame = 0; frame < frames; frame++) {
    nds.frame = frame;
    previous = held;
    held = new Set(held);
    for (const button of buttons) {
      if (random() < 0.03) {
        if (held.has(button)) held.delete(button);
        else held.add(button);
      }
    }
    const wasDown = touch.down;
    if (random() < (wasDown ? 0.08 : 0.05)) touch.down = !wasDown;
    if (touch.down && !wasDown) {
      touch.x = Math.floor(random() * 256);
      touch.y = Math.floor(random() * 192);
    } else if (touch.down) {
      touch.x = Math.max(0, Math.min(255, touch.x + Math.round((random() - 0.5) * 24)));
      touch.y = Math.max(0, Math.min(191, touch.y + Math.round((random() - 0.5) * 24)));
    }
    touch.pressed = touch.down && !wasDown;
    touch.released = !touch.down && wasDown;
    top.beginFrame();
    context.game.update();
    context.game.draw();
    assert.ok(!top.overflowed, `frame ${frame}: the top screen exceeded ${TOP_QUAD_LIMIT} hardware quads`);
    peakQuads = Math.max(peakQuads, top.quads);
  }
  return { peakQuads, tones, top, bottom };
}

for (const name of examples) {
  test(`example ${name} compiles to ES5 and survives a minute of random input on both screens`, () => {
    buildGame(path.join(root, 'examples', name, 'main.ts'), path.join(temporary, name));
    const script = readFileSync(path.join(temporary, name, 'game.js'), 'utf8');
    assert.doesNotMatch(script, /\b(?:const|let|class)\b|=>/);
    for (const seed of [1, 42]) {
      const result = play(script, 3600, seed);
      assert.ok(result.peakQuads > 0);
      assert.ok(new Set(result.top.pixels).size > 1, 'the top screen must draw something');
      assert.ok(new Set(result.bottom.pixels).size > 1, 'the bottom screen must draw something');
    }
  });
}
