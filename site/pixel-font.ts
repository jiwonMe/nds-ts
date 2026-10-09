import { FONT_BITMAPS } from '../sdk/font.js';

/** Draws text in the engine's own 3 x 5 font as an SVG of merged pixel runs.
 * The SVG is 4 units per character, so CSS can scale it by whole pixels. */
export function pixelText(value: string): string {
  const characters = [...value.toUpperCase()];
  let rects = '';
  characters.forEach((character, index) => {
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
        rects += `<rect x="${index * 4 + first}" y="${row}" width="${column - first}" height="1"/>`;
      }
    }
  });
  const width = Math.max(1, characters.length * 4 - 1);
  return `<svg class="pixel-text" viewBox="0 0 ${width} 5" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
