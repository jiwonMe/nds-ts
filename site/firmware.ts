import { FONT_BITMAPS } from '../sdk/font.js';
import type { Framebuffer } from '../sdk/framebuffer.js';
import type { Firmware } from './console.js';

const INK = 0x202024;
const MUTED = 0x6E7380;

function centered(screen: Framebuffer, value: string, y: number, color: number): void {
  screen.text(value, Math.round(128 - (value.length * 4 - 1) / 2), y, color);
}

/** Text in the engine's 3 x 5 font, scaled up with one rect per pixel run. */
function bigText(screen: Framebuffer, value: string, y: number, scale: number, color: number): void {
  const left = Math.round(128 - ((value.length * 4 - 1) * scale) / 2);
  [...value].forEach((character, index) => {
    const bits = FONT_BITMAPS[character.charCodeAt(0) - 32] ?? 0;
    for (let row = 0; row < 5; row++) {
      let column = 0;
      while (column < 3) {
        if (!(bits & (1 << (row * 3 + column)))) {
          column++;
          continue;
        }
        const first = column;
        while (column < 3 && bits & (1 << (row * 3 + column))) column++;
        screen.rect(left + (index * 4 + first) * scale, y + row * scale, (column - first) * scale, scale, color);
      }
    }
  });
}

function warningSign(screen: Framebuffer, x: number, y: number): void {
  for (let row = 0; row < 11; row++) {
    const half = Math.floor((row + 1) / 2);
    screen.rect(x + 6 - half, y + row, half * 2 + 1, 1, 0xF5B800);
  }
  screen.rect(x + 6, y + 3, 1, 4, INK);
  screen.rect(x + 6, y + 8, 1, 1, INK);
}

/** The first screen after power-on: a start-up notice that the compiler already read. */
export const safetyNotice: Firmware = (top, bottom, tick, input) => {
  top.clear(0xFFFFFF);
  warningSign(top, 12, 10);
  top.text('WARNING - TYPE SAFETY', 32, 14, INK);
  top.rect(12, 28, 232, 1, 0xDCDFE6);
  top.text(
    'BEFORE PLAYING, LET THE COMPILER READ YOUR\nGAME. EVERY CARTRIDGE ON THIS PAGE WAS\nCHECKED AGAINST ES5 AND THE NDS SDK.',
    12, 38, INK,
  );
  top.text('IMPORTS, MAP, SET AND PROMISE NEVER REACH\nTHE CONSOLE.', 12, 66, MUTED);
  bigText(top, 'NDS-TS', 112, 4, INK);
  centered(top, 'TYPESCRIPT ON TWO SCREENS', 142, MUTED);

  bottom.clear(0xFFFFFF);
  bottom.sprite('orb', 120, 56 - Math.round(Math.abs(Math.sin(tick / 9)) * 10));
  bottom.rect(112, 73, 32, 2, 0xE6E8EE);
  if (tick % 60 < 40) centered(bottom, 'TOUCH THE TOUCH SCREEN TO CONTINUE.', 96, INK);
  bottom.rect(0, 189, Math.min(256, Math.round((tick / 240) * 256)), 3, 0xD6008F);
  return tick < 240 && !input.touched && !input.pressed;
};

/** A short splash while a cartridge is inserted. */
export function insertSplash(title: string): Firmware {
  return (top, bottom, tick) => {
    const fade = Math.min(1, tick / 12);
    const level = Math.round(0xFF * fade);
    top.clear(0x000000);
    bigText(top, 'NDS-TS', 70, 5, (level << 16) | (level << 8) | level);
    centered(top, 'TYPESCRIPT ON TWO SCREENS', 106, tick > 12 ? 0x9AA0AE : 0x000000);
    bottom.clear(0x000000);
    centered(bottom, title.toUpperCase(), 84, 0xFFFFFF);
    bottom.rect(78, 100, 100, 4, 0x2A2D36);
    bottom.rect(78, 100, Math.round(Math.min(1, tick / 36) * 100), 4, 0xD6008F);
    return tick < 42;
  };
}
