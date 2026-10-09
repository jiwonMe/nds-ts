/** The SDK at a glance, summarized from sdk/index.d.ts and the README. */
export interface ApiGroup {
  id: string;
  title: string;
  /** Where the group lives on the `nds` object. */
  path: string;
  intro: string;
  items: [signature: string, description: string][];
  tags?: string[];
  note?: string;
}

export const API_GROUPS: ApiGroup[] = [
  {
    id: 'screens',
    title: 'Screens',
    path: 'nds.top, nds.bottom',
    intro: 'Two 256 × 192 displays share the same four calls. Colors are 0xRRGGBB integers, shown in RGB15 like the hardware.',
    items: [
      ['clear(color)', 'Fills the whole screen.'],
      ['rect(x, y, w, h, color)', 'Fills a rectangle. Coordinates round to whole pixels and clip at the edges.'],
      ['text(value, x, y, color)', 'Printable ASCII in the 3×5 font, drawn uppercase. 4-pixel advance, 7-pixel lines, at most 1024 bytes.'],
      ["sprite('orb', x, y)", 'Draws the built-in 16×16 orb from its top-left corner.'],
    ],
    note: 'On the top screen each clear, rect, lit text pixel and run of sprite pixels is one hardware quad. A frame may use 1500.',
  },
  {
    id: 'input',
    title: 'Buttons',
    path: 'nds.input',
    intro: 'Button state is sampled once per tick, so a press is seen the same way on every target.',
    items: [
      ['down(button)', 'True on every tick the button is held.'],
      ['hit(button)', 'True on the first tick of a press.'],
      ['up(button)', 'True on the first tick after release.'],
      ['dx(), dy()', 'The D-pad as -1, 0 or 1 on each axis. Opposite buttons cancel.'],
    ],
    tags: ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'],
  },
  {
    id: 'touch',
    title: 'Touch',
    path: 'nds.touch',
    intro: 'The stylus only exists on the bottom screen. Positions are in its own pixels.',
    items: [
      ['x, y', 'The last stylus position. It stays put after the stylus lifts.'],
      ['down', 'True while the stylus touches the screen.'],
      ['pressed', 'True on the first tick of contact.'],
      ['released', 'True on the first tick after lifting.'],
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    path: 'nds.audio',
    intro: 'One square-wave voice, played by the DS sound hardware or by Web Audio in the browser.',
    items: [
      ['tone(hz, frames, volume?)', '40 to 4000 Hz, 1 to 600 ticks long, volume 0 to 1 with 0.3 as the default.'],
    ],
    note: 'A new tone replaces the one that is playing. Arguments outside these ranges throw.',
  },
  {
    id: 'runtime',
    title: 'Runtime',
    path: 'nds.frame, nds.stats',
    intro: 'Read-only numbers about the running game.',
    items: [
      ['frame', 'The simulation tick, counting from 0.'],
      ['width, height', '256 and 192, for each display.'],
      ['stats.heapBytes, stats.heapPeakBytes', 'Duktape heap in use and its peak. Browsers report 0.'],
      ['stats.updateMicros, stats.drawMicros', 'Time the previous tick spent in each callback.'],
    ],
  },
  {
    id: 'game',
    title: 'Game loop',
    path: 'var game: NDSGame',
    intro: 'A game is one global script that defines game. The runtime calls it, never the other way round.',
    items: [
      ['init()', 'Optional. Runs once after the script loads.'],
      ['update()', 'Runs once per tick, before draw. Keep state outside it.'],
      ['draw()', 'Repaints both screens every tick.'],
    ],
    note: 'Callbacks receive this = game on both targets. A tick that misses VBlank slows the game down rather than skipping frames.',
  },
];
