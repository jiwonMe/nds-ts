import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonName, color, coordinate, spriteName, textBytes, toneArguments } from '../sdk/runtime-validation.js';

const unsafeNumber = (value: unknown) => value as number;
const unsafeString = (value: unknown) => value as string;

test('coordinates round negative ties like JavaScript and reject values outside native integer bounds', () => {
  assert.equal(coordinate(-32768), -32768);
  assert.equal(coordinate(32767), 32767);
  assert.equal(coordinate(-1.5), -1);
  assert.equal(coordinate(1.5), 2);
  assert.ok(Object.is(coordinate(-0.5), 0), 'negative zero must be normalized');
  for (const value of [NaN, Infinity, -Infinity, -32768.1, 32767.1]) {
    assert.throws(() => coordinate(value), RangeError);
  }
  for (const value of [null, undefined, '1', true]) {
    assert.throws(() => coordinate(unsafeNumber(value)), TypeError);
  }
});

test('colors reject fractions, coercion, and numbers that cannot represent an RGB color', () => {
  assert.equal(color(0), 0);
  assert.equal(color(0xFFFFFF), 0xFFFFFF);
  for (const value of [-1, 0x1000000, 2.5, NaN, Infinity]) assert.throws(() => color(value), RangeError);
  assert.throws(() => color(unsafeNumber('0xffffff')), TypeError);
});

test('tone arguments preserve silent volume, truncate frequency, and enforce duration and hardware limits', () => {
  assert.deepEqual(toneArguments(660.9, 7), [660, 7, 0.3]);
  assert.deepEqual(toneArguments(40, 1, 0), [40, 1, 0]);
  assert.deepEqual(toneArguments(4000, 600, 1), [4000, 600, 1]);
  for (const args of [[39.9, 7, 0.3], [4000.1, 7, 0.3], [660, 0, 0.3], [660, 601, 0.3],
    [660, 7.5, 0.3], [660, 7, -0.1], [660, 7, 1.1], [NaN, 7, 0.3], [660, Infinity, 0.3]] as const) {
    assert.throws(() => toneArguments(args[0], args[1], args[2]), RangeError);
  }
  assert.throws(() => toneArguments(unsafeNumber('660'), 7), TypeError);
  assert.throws(() => toneArguments(660, 7, unsafeNumber(null)), TypeError);
});

test('text accepts the shared printable font and newline, and rejects truncation and unsupported encodings', () => {
  assert.deepEqual(textBytes('A z!\n09'), [65, 32, 122, 33, 10, 48, 57]);
  assert.equal(textBytes('A'.repeat(1024)).length, 1024);
  for (const text of ['A'.repeat(1025), 'A\0B', '\t', '\r', '한글', '🙂']) {
    assert.throws(() => textBytes(text), RangeError);
  }
  assert.throws(() => textBytes(unsafeString(123)), TypeError);
});

test('input and sprite names fail consistently instead of silently ignoring mistakes', () => {
  assert.equal(buttonName('right'), 'right');
  assert.equal(buttonName('select'), 'select');
  assert.equal(spriteName('orb'), 'orb');
  assert.throws(() => buttonName('RIGHT' as NDSButton), RangeError);
  assert.throws(() => buttonName(unsafeString(0) as NDSButton), TypeError);
  assert.throws(() => spriteName('missing' as 'orb'), RangeError);
  assert.throws(() => spriteName(unsafeString(null) as 'orb'), TypeError);
});
