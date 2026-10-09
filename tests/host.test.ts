import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildGame } from '../tools/build-script.js';

type Position = { x: number; y: number; vy: number };
type GameContext = vm.Context & {
  player: Position; accentIndex: number; hops: number; teleports: number;
  game: { init(): void; update(): void; draw(): void };
};
const temporary = mkdtempSync(path.join(tmpdir(), 'nds-ts-host-tests-'));
let script: string;
before(() => {
  buildGame(undefined, temporary);
  script = readFileSync(path.join(temporary, 'game.js'), 'utf8');
});
after(() => rmSync(temporary, { recursive: true, force: true }));

function gameHarness() {
  let current = new Set<string>();
  let previous = new Set<string>();
  let wasTouched = false;
  const tones: number[][] = [];
  const draws: { screen: string; method: string; args: unknown[] }[] = [];
  const screen = (name: string) => Object.fromEntries(['clear', 'rect', 'text', 'sprite'].map(method =>
    [method, (...args: unknown[]) => draws.push({ screen: name, method, args })]));
  const nds = {
    width: 256, height: 192, frame: 0,
    stats: { heapBytes: 0, heapPeakBytes: 0, updateMicros: 0, drawMicros: 0 },
    input: {
      down: (key: string) => current.has(key),
      hit: (key: string) => current.has(key) && !previous.has(key),
      up: (key: string) => !current.has(key) && previous.has(key),
      dx: () => Number(current.has('right')) - Number(current.has('left')),
      dy: () => Number(current.has('down')) - Number(current.has('up')),
    },
    touch: { x: 0, y: 0, down: false, pressed: false, released: false },
    top: screen('top'), bottom: screen('bottom'),
    audio: { tone: (...args: number[]) => tones.push(args) },
  };
  const context = vm.createContext({ nds }) as GameContext;
  new vm.Script(script, { filename: 'compiled-game.js' }).runInContext(context, { timeout: 1000 });
  context.game.init();
  return {
    context, nds, tones, draws,
    frame(keys: string[] = [], touch?: [number, number]) {
      current = new Set(keys);
      nds.touch.down = Boolean(touch);
      nds.touch.pressed = Boolean(touch) && !wasTouched;
      nds.touch.released = !touch && wasTouched;
      if (touch) [nds.touch.x, nds.touch.y] = touch;
      context.game.update();
      context.game.draw();
      nds.frame += 1;
      previous = current;
      wasTouched = Boolean(touch);
    },
  };
}

test('compiler embeds the same runnable ES5 game bytes into the native header', () => {
  const header = readFileSync(path.join(temporary, 'script_gen.h'), 'utf8');
  const encoded = Array.from(header.matchAll(/0x([0-9a-f]{2})(?=[,\s])/g), match => Number.parseInt(match[1], 16));
  assert.equal(encoded.at(-1), 0, 'C script must be null terminated');
  assert.equal(Buffer.from(encoded.slice(0, -1)).toString('utf8'), script);
  assert.match(header, new RegExp(`GAME_SCRIPT_LENGTH = ${Buffer.byteLength(script)};`));
  assert.doesNotMatch(script, /\b(?:const|let|class)\b|=>/);
  const harness = gameHarness();
  harness.frame();
  assert.equal(harness.draws.filter(call => call.method === 'clear').length, 2);
  assert.deepEqual(harness.draws.find(call => call.method === 'sprite')?.args, ['orb', 120, 138]);
});

test('one compiled game handles opposing directions, bounds, jump edges, landing, and reset', () => {
  const harness = gameHarness();
  const state = harness.context;
  for (let frame = 0; frame < 30; frame++) harness.frame(['right']);
  assert.equal(state.player.x, 180);
  harness.frame(['left', 'right']);
  assert.equal(state.player.x, 180, 'opposing D-pad buttons cancel');
  for (let frame = 0; frame < 100; frame++) harness.frame(['left']);
  assert.equal(state.player.x, 8, 'left motion is clamped to the visible playfield');
  for (let frame = 0; frame < 150; frame++) harness.frame(['right']);
  assert.equal(state.player.x, 232, 'right motion is clamped to the visible playfield');
  for (let frame = 0; frame < 90; frame++) harness.frame(['a']);
  assert.equal(state.hops, 1, 'a held button must not jump again after landing');
  assert.equal(state.player.y, 138);
  assert.equal(state.player.vy, 0);
  assert.equal(harness.tones.filter(tone => tone[0] === 660).length, 1);
  harness.frame();
  harness.frame(['a']);
  assert.equal(state.hops, 2);
  assert.ok(state.player.y < 138);
  for (let frame = 0; frame < 90; frame++) harness.frame();
  assert.equal(state.player.y, 138);
  state.game.init();
  assert.deepEqual(JSON.parse(JSON.stringify(state.player)), { x: 120, y: 138, vy: 0 });
  assert.equal(state.hops, 0);
});

test('touch is edge-triggered and safely relocates the player at screen boundaries', () => {
  const harness = gameHarness();
  harness.frame([], [60, 80]);
  assert.equal(harness.context.player.x, 52);
  assert.ok(Math.abs(harness.context.player.y - 72.32) < 0.001);
  assert.equal(harness.context.teleports, 1);
  for (let frame = 0; frame < 10; frame++) harness.frame([], [200, 10]);
  assert.equal(harness.context.player.x, 52, 'dragging a held touch does not re-teleport');
  assert.equal(harness.context.teleports, 1);
  harness.frame();
  harness.frame([], [0, 0]);
  assert.equal(harness.context.player.x, 8);
  assert.ok(harness.context.player.y >= 16);
  harness.frame();
  harness.frame([], [255, 191]);
  assert.equal(harness.context.player.x, 232);
  assert.equal(harness.context.player.y, 138);
  assert.equal(harness.context.teleports, 3);
  assert.equal(harness.tones.filter(tone => tone[0] === 880).length, 3);
});

test('palette changes once per press, cycles, and redraws both displays', () => {
  const harness = gameHarness();
  for (let press = 1; press <= 3; press++) {
    harness.frame(['b']);
    for (let frame = 0; frame < 20; frame++) harness.frame(['b']);
    assert.equal(harness.context.accentIndex, press % 3);
    harness.frame();
  }
  assert.equal(harness.tones.length, 3);
  assert.ok(harness.draws.some(call => call.screen === 'top' && call.method === 'text'));
  assert.ok(harness.draws.some(call => call.screen === 'bottom' && call.method === 'text'));
});

test('compiler rejects module imports and APIs unavailable on the DS', () => {
  const fixture = path.join(temporary, 'invalid.ts');
  writeFileSync(fixture, "import other from './other'; var game: NDSGame = other;\n");
  assert.throws(() => buildGame(fixture, path.join(temporary, 'reject-module')), /imports and exports are unsupported/);
  writeFileSync(fixture, 'var game: NDSGame = { update: function () { document.body.textContent = "bad"; }, draw: function () {} };\n');
  assert.throws(() => buildGame(fixture, path.join(temporary, 'reject-dom')), /Cannot find name 'document'/);
  writeFileSync(fixture, 'var game: NDSGame = { update: function () { nds.audio.tone("bad", 5); }, draw: function () {} };\n');
  assert.throws(() => buildGame(fixture, path.join(temporary, 'reject-api')), /not assignable to parameter of type 'number'/);
});

test('compiler rejects references to code and richer runtimes that are absent from the ROM', () => {
  const fixture = path.join(temporary, 'reference.ts');
  const helper = path.join(temporary, 'helper.ts');
  writeFileSync(helper, 'function externalHelper(): void {}\n');
  const cases = [
    ['/// <reference path="./helper.ts" />\nvar game: NDSGame = { update: function () { externalHelper(); }, draw: function () {} };', /reference|global script/i],
    ['/// <reference lib="es2015" />\nvar game: NDSGame = { update: function () { new Map(); }, draw: function () {} };', /reference|ES5/i],
    ['/// <reference types="node" />\nvar game: NDSGame = { update: function () { process.exit(); }, draw: function () {} };', /reference|Node/i],
    ['var game: NDSGame = { update: function () { import("./helper"); }, draw: function () {} };', /import|global script|module/i],
    ['type Other = import("./helper").Other; var game: NDSGame = { update: function () {}, draw: function () {} };', /import|global script|module/i],
  ] as const;
  for (const [source, rejection] of cases) {
    writeFileSync(fixture, source + '\n');
    assert.throws(() => buildGame(fixture, path.join(temporary, 'reject-reference')), rejection);
  }
});

test('an entry named like the previous validation file is compiled and embedded intact', () => {
  const fixture = path.join(temporary, '__validate_game.ts');
  writeFileSync(fixture, 'var marker = 7; var game: NDSGame = { update: function () { marker += 1; }, draw: function () {} };\n');
  buildGame(fixture, temporary);
  const emitted = readFileSync(path.join(temporary, 'game.js'), 'utf8');
  const context = vm.createContext({});
  new vm.Script(emitted).runInContext(context);
  context.game.update();
  assert.equal(context.marker, 8, 'the actual entry must not be replaced by a virtual validation file');
  assert.match(emitted, /marker = 7/);
});
