import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPixel, Framebuffer, SCREEN_WIDTH, TOP_QUAD_LIMIT } from '../sdk/framebuffer.js';

test('colors are quantized to RGB15 and expanded the way the DS displays them', () => {
  assert.equal(displayPixel(0xFFFFFF), 0xFFFFFFFF);
  assert.equal(displayPixel(0x0F0F0F), 0xFF080808);
  assert.equal(displayPixel(0xD6008F), 0xFF8C00D6, 'RGBA bytes are little-endian for ImageData');
});

test('top screen counts native quads for clears, rects, glyph pixels and orb runs', () => {
  const top = new Framebuffer(true);
  top.clear(0xFFFFFF);
  top.rect(10, 10, 0, 5, 0);
  top.rect(300, 10, 5, 5, 0);
  assert.equal(top.quads, 1, 'empty and off-screen rects submit nothing');
  top.rect(-5, -5, 10, 10, 0);
  assert.equal(top.quads, 2, 'a clipped rect is still one quad');
  top.beginFrame();
  top.text('A', 0, 0, 0);
  assert.equal(top.quads, 10, 'every lit pixel of the 3 x 5 glyph is a quad');
  top.beginFrame();
  top.text('A', -2, 0, 0);
  assert.equal(top.quads, 4, 'clipped glyph columns are skipped');
  top.beginFrame();
  top.sprite('orb', 0, 0);
  assert.equal(top.quads, 50, 'neighboring orb pixels of one color share a quad');
});

test('top screen starts each frame black and drops quads past the hardware limit', () => {
  const top = new Framebuffer(true);
  const bottom = new Framebuffer();
  top.clear(0xFFFFFF);
  bottom.clear(0xFFFFFF);
  top.beginFrame();
  bottom.beginFrame();
  assert.equal(top.pixels[0], displayPixel(0), 'hardware geometry does not persist');
  assert.equal(bottom.pixels[0], displayPixel(0xFFFFFF), 'the bottom bitmap keeps its pixels');
  for (let quad = 0; quad < TOP_QUAD_LIMIT; quad++) top.rect(quad % SCREEN_WIDTH, 0, 1, 1, 0xFFFFFF);
  assert.equal(top.overflowed, false);
  top.rect(0, 100, 1, 1, 0xFFFFFF);
  assert.equal(top.overflowed, true);
  assert.equal(top.quads, TOP_QUAD_LIMIT);
  assert.equal(top.pixels[100 * SCREEN_WIDTH], displayPixel(0), 'a dropped quad draws nothing');
});

test('drawing validates arguments exactly like the native bindings', () => {
  const screen = new Framebuffer();
  assert.throws(() => screen.rect(0, 0, 4, 4, 0x1000000), RangeError);
  assert.throws(() => screen.text('é', 0, 0, 0), RangeError);
  assert.throws(() => screen.sprite('star' as 'orb', 0, 0), RangeError);
  assert.throws(() => screen.rect(Infinity, 0, 4, 4, 0), RangeError);
});
