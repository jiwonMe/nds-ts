/** Software copy of native/graphics.cpp for previews and tests.
 *
 * Pixels use the same RGB15 quantization, 3 × 5 font, orb raster, rounding and
 * clipping as the ROM. A screen created with `hardwareQuads` also follows the
 * top display's rules: it starts every frame black, counts one quad per
 * clear/rect, glyph pixel and sprite run, and drops quads past the limit. */
import { FONT_BITMAPS } from './font.js';
import { color as validColor, coordinate, spriteName, textBytes } from './runtime-validation.js';

export const SCREEN_WIDTH = 256;
export const SCREEN_HEIGHT = 192;
export const TOP_QUAD_LIMIT = 1500;

/** Converts 0xRRGGBB to the displayed RGB15 color, packed as little-endian RGBA. */
export function displayPixel(color: number): number {
  const expand = (shift: number) => {
    const value = ((color >>> shift) & 255) >>> 3;
    return (value << 3) | (value >>> 2);
  };
  return (0xFF000000 | (expand(0) << 16) | (expand(8) << 8) | expand(16)) >>> 0;
}

/** Native orbPixel(): 0 means transparent. */
function orbColor(column: number, row: number): number {
  const dx = 2 * column - 15;
  const dy = 2 * row - 15;
  const distance = dx * dx + dy * dy;
  if (distance > 225) return 0;
  let color = distance > 169 ? 0x202020 : 0xD6008F;
  if (distance <= 169 && row >= 11) color = 0xA80070;
  if (distance <= 169 && column >= 3 && column <= 6 && row >= 3 && row <= 5) color = 0xFFC2E9;
  if ((column === 5 || column === 10) && (row === 7 || row === 8)) color = 0x202020;
  return color;
}

const ORB = Array.from({ length: 256 }, (_, index) => {
  const color = orbColor(index % 16, Math.floor(index / 16));
  return color ? displayPixel(color) : 0;
});
const BLACK = displayPixel(0x000000);

export class Framebuffer implements NDSScreen {
  readonly pixels: Uint32Array<ArrayBuffer>;
  /** Quads submitted this frame; only counted for hardware screens. */
  quads = 0;
  overflowed = false;

  constructor(readonly hardwareQuads = false, pixels = new Uint32Array(SCREEN_WIDTH * SCREEN_HEIGHT)) {
    this.pixels = pixels;
    if (hardwareQuads) this.pixels.fill(BLACK);
  }

  /** Mirrors Screen::beginFrame(): hardware geometry does not persist between frames. */
  beginFrame(): void {
    this.quads = 0;
    this.overflowed = false;
    if (this.hardwareQuads) this.pixels.fill(BLACK);
  }

  clear(color: number): void {
    const pixel = displayPixel(validColor(color));
    if (this.quad()) this.pixels.fill(pixel);
  }

  rect(x: number, y: number, width: number, height: number, color: number): void {
    const px = coordinate(x), py = coordinate(y);
    const w = coordinate(width), h = coordinate(height);
    const pixel = displayPixel(validColor(color));
    if (w <= 0 || h <= 0) return;
    const left = Math.max(0, px), top = Math.max(0, py);
    const right = Math.min(SCREEN_WIDTH, px + w), bottom = Math.min(SCREEN_HEIGHT, py + h);
    if (left >= right || top >= bottom || !this.quad()) return;
    for (let row = top; row < bottom; row++) {
      this.pixels.fill(pixel, row * SCREEN_WIDTH + left, row * SCREEN_WIDTH + right);
    }
  }

  text(value: string, x: number, y: number, color: number): void {
    const bytes = textBytes(value);
    const originX = coordinate(x);
    let cursorX = originX;
    let cursorY = coordinate(y);
    const pixel = displayPixel(validColor(color));
    for (let code of bytes) {
      if (code === 10) {
        cursorX = originX;
        cursorY += 7;
        continue;
      }
      if (code >= 97 && code <= 122) code -= 32;
      const bits = FONT_BITMAPS[code - 32] ?? 0;
      if (bits && cursorX > -3 && cursorX < SCREEN_WIDTH && cursorY > -5 && cursorY < SCREEN_HEIGHT) {
        for (let bit = 0; bit < 15; bit++) {
          if (!(bits & (1 << bit))) continue;
          const px = cursorX + bit % 3, py = cursorY + Math.floor(bit / 3);
          if (px < 0 || px >= SCREEN_WIDTH || py < 0 || py >= SCREEN_HEIGHT) continue;
          if (this.quad()) this.pixels[py * SCREEN_WIDTH + px] = pixel;
        }
      }
      cursorX += 4;
    }
  }

  sprite(name: 'orb', x: number, y: number): void {
    spriteName(name);
    const originX = coordinate(x), originY = coordinate(y);
    if (originX <= -16 || originX >= SCREEN_WIDTH || originY <= -16 || originY >= SCREEN_HEIGHT) return;
    const firstColumn = Math.max(0, -originX), lastColumn = Math.min(16, SCREEN_WIDTH - originX);
    const firstRow = Math.max(0, -originY), lastRow = Math.min(16, SCREEN_HEIGHT - originY);
    for (let row = firstRow; row < lastRow; row++) {
      // Like the native top renderer, one quad covers each run of same-colored pixels.
      let column = firstColumn;
      while (column < lastColumn) {
        const pixel = ORB[row * 16 + column];
        const first = column++;
        while (column < lastColumn && ORB[row * 16 + column] === pixel) column++;
        if (!pixel || !this.quad()) continue;
        const offset = (originY + row) * SCREEN_WIDTH + originX;
        this.pixels.fill(pixel, offset + first, offset + column);
      }
    }
  }

  private quad(): boolean {
    if (!this.hardwareQuads) return true;
    if (this.quads >= TOP_QUAD_LIMIT) {
      this.overflowed = true;
      return false;
    }
    this.quads++;
    return true;
  }
}
