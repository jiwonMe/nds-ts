/** The handheld as SVG line art, drawn after the Nintendo DS Lite's front view.
 *
 * 'wide' keeps the real proportions: 133 mm across, a 62 x 46 mm screen in each
 * half, the D-pad and face buttons beside the touchscreen. 'compact' moves the
 * controls under the touchscreen for narrow windows. Units are DS pixels, so
 * each screen's canvas lies exactly over the window drawn for it, and both
 * halves are equally tall so the folded lid covers the base. */

export type Layout = 'wide' | 'compact';

export interface Geometry {
  width: number;
  lid: number;
  hinge: number;
  /** The base below the hinge. It also runs up behind the hinge's lower half. */
  base: number;
  /** Radius of the corners away from the hinge. */
  corner: number;
  /** Width of each end of the hinge: the left one is L, the right one R. */
  knuckle: number;
  screenX: number;
  topY: number;
  bottomY: number;
  /** Margin between a screen and the edge of its recess. */
  bezel: number;
  speakers: { x: [number, number]; y: number; gap: number; radius: number };
  /** The rubber pads in the lid's corners. */
  pads: boolean;
  dpad: { x: number; y: number; reach: number; arm: number };
  face: { x: number; y: number; gap: number; radius: number };
  meta: { x: number; y: [number, number]; radius: number; text: number };
  leds: [number, number];
}

export const GEOMETRY: Record<Layout, Geometry> = {
  // Measured from the DS Lite, where one DS pixel is about 0.24 mm.
  wide: {
    width: 550, lid: 270, hinge: 36, base: 270, corner: 19, knuckle: 68,
    screenX: 147, topY: 41, bottomY: 28, bezel: 16,
    speakers: { x: [68, 482], y: 141, gap: 20, radius: 2.6 },
    pads: true,
    dpad: { x: 63, y: 100, reach: 37, arm: 13 },
    face: { x: 486, y: 88, gap: 31.5, radius: 15 },
    meta: { x: 446.5, y: [190, 221.5], radius: 7.5, text: 7.5 },
    leds: [500.5, 509.5],
  },
  compact: {
    width: 288, lid: 304, hinge: 30, base: 304, corner: 16, knuckle: 50,
    screenX: 16, topY: 20, bottomY: 16, bezel: 8,
    speakers: { x: [58, 230], y: 262, gap: 18, radius: 2.4 },
    pads: false,
    dpad: { x: 58, y: 260, reach: 30, arm: 10.5 },
    face: { x: 230, y: 260, gap: 23, radius: 11 },
    meta: { x: 130, y: [248, 272], radius: 6.5, text: 6.5 },
    leds: [250, 258],
  },
};

/** How far a key's cap sits above its collar. */
const LIP = 2;

type Point = [number, number];
const n = (value: number) => Math.round(value * 100) / 100;

/** A box whose top corners and bottom corners have their own radii. */
function box(width: number, height: number, top: number, bottom: number, inset = 0): string {
  const l = inset, t = inset, r = n(width - inset), b = n(height - inset);
  const rt = n(Math.max(top - inset, 0)), rb = n(Math.max(bottom - inset, 0));
  return `M${l} ${n(t + rt)}A${rt} ${rt} 0 0 1 ${n(l + rt)} ${t}H${n(r - rt)}A${rt} ${rt} 0 0 1 ${r} ${n(t + rt)}` +
    `V${n(b - rb)}A${rb} ${rb} 0 0 1 ${n(r - rb)} ${b}H${n(l + rb)}A${rb} ${rb} 0 0 1 ${l} ${n(b - rb)}Z`;
}

/** The base's sides and bottom. Its top edge would run behind the hinge. */
function tray(width: number, top: number, height: number, radius: number, inset = 0): string {
  const l = inset, r = n(width - inset), b = n(height - inset), rb = n(radius - inset);
  return `M${l} ${top}V${n(b - rb)}A${rb} ${rb} 0 0 0 ${n(l + rb)} ${b}H${n(r - rb)}A${rb} ${rb} 0 0 0 ${r} ${n(b - rb)}V${top}`;
}

/** A polygon with each corner eased by its own radius. */
function rounded(points: Point[], radii: number[]): string {
  return points.map(([x, y], index) => {
    const [px, py] = points[(index + points.length - 1) % points.length];
    const [nx, ny] = points[(index + 1) % points.length];
    const r = radii[index];
    const back = Math.hypot(px - x, py - y), ahead = Math.hypot(nx - x, ny - y);
    const from = `${n(x + ((px - x) / back) * r)} ${n(y + ((py - y) / back) * r)}`;
    const to = `${n(x + ((nx - x) / ahead) * r)} ${n(y + ((ny - y) / ahead) * r)}`;
    return `${index ? 'L' : 'M'}${from}Q${n(x)} ${n(y)} ${to}`;
  }).join('') + 'Z';
}

function svg(layout: Layout, viewBox: string, body: string): string {
  return `<svg class="ds-art ds-art-${layout}" viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;
}

/** The glass edge just outside a screen's canvas. */
function glass(x: number, y: number): string {
  return `<rect class="detail" x="${x - 2.5}" y="${y - 2.5}" width="261" height="197" rx="2"/>`;
}

function dpad({ dpad: { x, y, reach: l, arm: a } }: Geometry): string {
  const end = n(a * 0.28);
  const cross = (dy: number) => rounded(([
    [x - a, y - l], [x + a, y - l], [x + a, y - a], [x + l, y - a], [x + l, y + a], [x + a, y + a],
    [x + a, y + l], [x - a, y + l], [x - a, y + a], [x - l, y + a], [x - l, y - a], [x - a, y - a],
  ] as Point[]).map(([px, py]): Point => [px, py + dy]), [end, end, 1.5, end, end, 1.5, end, end, 1.5, end, end, 1.5]);
  // Each arm is drawn pointing up, then turned into place.
  const arms = (['up', 'right', 'down', 'left'] as const).map((name, quarter) => {
    const c = [1, 0, -1, 0][quarter], s = [0, 1, 0, -1][quarter];
    const turn = ([px, py]: Point): Point => [x + (px - x) * c - (py - y) * s, y + (px - x) * s + (py - y) * c];
    const face = rounded(([[x - a, y - a], [x - a, y - l], [x + a, y - l], [x + a, y - a]] as Point[]).map(turn), [0, end, end, 0]);
    return `<g class="dpad-arm" data-button="${name}"><path class="arm-face" d="${face}"/></g>`;
  }).join('');
  return `<g class="ds-dpad">` +
    `<rect class="hit" x="${x - l}" y="${y - l}" width="${2 * l}" height="${2 * l}"/>` +
    `<path class="shell detail" d="${cross(LIP)}"/>` +
    `<g class="dpad-cap"><path class="shell edge" d="${cross(0)}"/>${arms}` +
    `<circle class="hint" cx="${x}" cy="${y}" r="${n(a * 0.55)}"/></g></g>`;
}

/** A round key: the collar below its cap shows how far it travels. */
function key(name: NDSButton, x: number, y: number, radius: number, label: string): string {
  return `<g class="ds-key" data-button="${name}">` +
    `<circle class="hit" cx="${x}" cy="${y}" r="${radius + 3}"/>` +
    `<circle class="shell detail" cx="${x}" cy="${y + LIP}" r="${radius}"/>` +
    `<g class="key-cap"><circle class="shell edge key-face" cx="${x}" cy="${y}" r="${radius}"/>` +
    `<text x="${x}" y="${y}" dy="0.36em" font-size="${n(radius * 0.8)}">${label}</text></g></g>`;
}

/** START and SELECT: a small key with its name printed beside it. */
function metaKey(name: NDSButton, x: number, y: number, radius: number, size: number, label: string): string {
  const width = radius * 2 + 4.5 + label.length * size * 0.66 + 6;
  return `<g class="ds-key" data-button="${name}">` +
    `<rect class="hit" x="${n(x - radius - 3)}" y="${n(y - radius - 3)}" width="${n(width)}" height="${radius * 2 + 6}"/>` +
    `<circle class="shell detail" cx="${x}" cy="${y + LIP * 0.75}" r="${radius}"/>` +
    `<g class="key-cap"><circle class="shell edge key-face" cx="${x}" cy="${y}" r="${radius}"/></g>` +
    `<text class="key-note" x="${n(x + radius + 4.5)}" y="${y}" dy="0.36em" font-size="${size}">${label}</text></g>`;
}

function lidFace(layout: Layout): string {
  const g = GEOMETRY[layout];
  const { width: w, lid: h, corner, screenX: sx, topY: sy, bezel: m, speakers: sp } = g;
  const holes = sp.x.flatMap((cx) => [-1, 0, 1].flatMap((column) => [-0.5, 0.5].map((row) =>
    `<circle cx="${n(cx + column * sp.gap)}" cy="${n(sp.y + row * sp.gap)}" r="${sp.radius}"/>`))).join('');
  const pads = g.pads
    ? ([[20, 9], [w - 31, 9], [20, h - 14], [w - 31, h - 14]] as Point[])
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="11" height="5" rx="2.5"/>`).join('')
    : '';
  return svg(layout, `0 0 ${w} ${h}`,
    `<path class="shell edge" d="${box(w, h, corner, 4)}"/>` +
    `<path class="hint" d="${box(w, h, corner, 4, 3.5)}"/>` +
    (pads ? `<g class="hint">${pads}</g>` : '') +
    `<g class="detail">${holes}</g>` +
    `<rect class="detail" x="${sx - m}" y="${sy - m}" width="${256 + m * 2}" height="${192 + m * 2}" rx="${n(m * 0.3)}"/>` +
    glass(sx, sy));
}

function lidBack(layout: Layout): string {
  const { width: w, lid: h, corner } = GEOMETRY[layout];
  // Folded shut, the lid's far edge is the front, so its big corners face down.
  const x = w / 2 - 17, y = h / 2 - 34;
  return svg(layout, `0 0 ${w} ${h}`,
    `<path class="shell edge" d="${box(w, h, 4, corner)}"/>` +
    `<path class="hint" d="${box(w, h, 4, corner, 3.5)}"/>` +
    `<g class="edge"><rect x="${x}" y="${y}" width="34" height="23" rx="5"/><rect x="${x}" y="${y + 26.5}" width="34" height="23" rx="5"/></g>` +
    `<rect class="mark" x="${x + 8.75}" y="${y + 8.5}" width="16.5" height="7" rx="1"/>` +
    `<text class="wordmark" x="${w / 2}" y="${y + 74}" font-size="15">nds-ts</text>`);
}

function hinge(layout: Layout): string {
  const { width: w, hinge: h, knuckle: k, leds } = GEOMETRY[layout];
  const r = h / 2;
  const slot = n(h / 8);
  // The power and charge lights sit on the right end, so they press R too.
  const lights = leds.map((x, index) => `<rect class="led" data-led="${index ? 'charge' : 'power'}" x="${n(x - slot / 2)}" ` +
    `y="${n(r - h * 0.21)}" width="${slot}" height="${n(h * 0.42)}" rx="${n(slot / 2)}"/>`).join('');
  const end = (side: 'l' | 'r') => {
    const d = side === 'l' ? `M${k} 0H${r}A${r} ${r} 0 0 0 ${r} ${h}H${k}Z` : `M${w - k} 0H${w - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${w - k}Z`;
    return `<g class="ds-knuckle" data-button="${side}"><path class="knuckle-face" d="${d}"/>` +
      `<text x="${side === 'l' ? r : w - r}" y="${r}" dy="0.36em" font-size="${n(h / 4)}">${side.toUpperCase()}</text>` +
      `${side === 'r' ? lights : ''}</g>`;
  };
  return svg(layout, `0 0 ${w} ${h}`,
    `<rect class="shell edge" width="${w}" height="${h}" rx="${r}"/>` +
    end('l') + end('r') +
    `<path class="detail" d="M${k} 0V${h}M${w - k} 0V${h}"/>` +
    `<rect class="mic" x="${n(w / 2 - slot / 2)}" y="${n(r - h / 6)}" width="${slot}" height="${n(h / 3)}" rx="${n(slot / 2)}"/>`);
}

function base(layout: Layout): string {
  const g = GEOMETRY[layout];
  const { width: w, base: h, corner, screenX: sx, bottomY: sy, bezel: m, face: f, meta } = g;
  const top = -g.hinge / 2;
  // The touchscreen's recess runs up under the hinge, with a shelf just below it.
  const left = sx - m, right = sx + 256 + m, shelf = sy - m, bottom = sy + 192 + m, rr = n(m * 0.3);
  const recess = `M${left} 0V${n(bottom - rr)}A${rr} ${rr} 0 0 0 ${n(left + rr)} ${bottom}H${n(right - rr)}A${rr} ${rr} 0 0 0 ${right} ${n(bottom - rr)}V0` +
    `M${left} ${n(shelf + rr)}A${rr} ${rr} 0 0 1 ${n(left + rr)} ${shelf}H${n(right - rr)}A${rr} ${rr} 0 0 1 ${right} ${n(shelf + rr)}`;
  return svg(layout, `0 ${top} ${w} ${h - top}`,
    `<path class="focus-ring" d="${tray(w, top, h, corner, -6)}"/>` +
    `<path class="shell" d="${tray(w, top, h, corner)}Z"/>` +
    `<path class="edge" d="${tray(w, top, h, corner)}"/>` +
    `<path class="hint" d="${tray(w, top, h, corner, 3.5)}"/>` +
    `<path class="detail" d="${recess}"/>` +
    glass(sx, sy) +
    dpad(g) +
    key('x', f.x, f.y - f.gap, f.radius, 'X') +
    key('y', f.x - f.gap, f.y, f.radius, 'Y') +
    key('a', f.x + f.gap, f.y, f.radius, 'A') +
    key('b', f.x, f.y + f.gap, f.radius, 'B') +
    metaKey('start', meta.x, meta.y[0], meta.radius, meta.text, 'START') +
    metaKey('select', meta.x, meta.y[1], meta.radius, meta.text, 'SELECT'));
}

/** Draws both layouts of every part, behind anything already in its container. */
export function mountHandheld(root: HTMLElement): void {
  const parts: [string, (layout: Layout) => string][] = [['lid', lidFace], ['back', lidBack], ['hinge', hinge], ['base', base]];
  for (const [name, draw] of parts) {
    root.querySelector(`[data-art="${name}"]`)!.insertAdjacentHTML('afterbegin', draw('wide') + draw('compact'));
  }
}

/** Puts one layout's sizes on the host as custom properties, which place the
 * screens and size the console bar to match. */
export function applyLayout(host: HTMLElement, root: HTMLElement, layout: Layout): void {
  const g = GEOMETRY[layout];
  const sizes: [string, number][] = [
    ['--ds-w', g.width], ['--ds-lid', g.lid], ['--ds-hinge', g.hinge], ['--ds-base', g.base],
    ['--ds-screen-x', g.screenX], ['--ds-top-y', g.topY], ['--ds-bottom-y', g.bottomY],
  ];
  for (const [name, value] of sizes) host.style.setProperty(name, String(value));
  root.dataset.layout = layout;
}
