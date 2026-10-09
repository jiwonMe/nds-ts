/** Page copy for each example game. The games themselves live in examples/. */
export interface Control {
  /** DS input, e.g. "A" or "Stylus". */
  input: string;
  /** Keyboard keys on this page, if any. */
  keys?: string;
  action: string;
}

/** A one-click edit for the code editor: replace `find` with `replace`. */
export interface Tweak {
  label: string;
  find: string;
  replace: string;
}

export interface CartridgeInfo {
  id: string;
  title: string;
  blurb: string;
  color: string;
  controls: Control[];
  tweaks: Tweak[];
  measured?: boolean;
}

export const CARTRIDGES: CartridgeInfo[] = [
  {
    id: 'hinge-breakout',
    title: 'Hinge Breakout',
    blurb: 'Bricks on the top screen, paddle on the bottom. The ball crosses the hinge.',
    color: '#ff5c8a',
    controls: [
      { input: 'Stylus', action: 'Steer the paddle' },
      { input: '◀ ▶', keys: 'Arrows', action: 'Steer the paddle' },
      { input: 'A', keys: 'Z', action: 'Launch the ball' },
    ],
    tweaks: [
      { label: 'Wide paddle', find: 'var paddleW = 44;', replace: 'var paddleW = 96;' },
      { label: 'Big ball', find: 'var BALL = 4;', replace: 'var BALL = 8;' },
      { label: 'Slow sparks', find: 'sparks[i + 3] + 0.16', replace: 'sparks[i + 3] + 0.03' },
    ],
  },
  {
    id: 'touch-synth',
    title: 'Touch Synth',
    blurb: 'A 16-step square-wave sequencer. Play the keys and record into the loop.',
    color: '#3bc9db',
    controls: [
      { input: 'Stylus', action: 'Play keys, tap steps' },
      { input: 'A', keys: 'Z', action: 'Play or stop' },
      { input: 'SELECT', keys: 'Shift', action: 'Record' },
      { input: 'L R', keys: 'Q E', action: 'Tempo' },
    ],
    tweaks: [
      { label: 'Major key', find: 'var LOOP = [9, 12, 16, 21, 19, 16, 12, 16, 5, 9, 12, 17, 16, 12, 11, 7];', replace: 'var LOOP = [0, 4, 7, 12, 11, 7, 4, 7, 5, 9, 12, 17, 16, 12, 7, 4];' },
      { label: 'Staccato', find: 'sound(pattern[step], TEMPOS[tempo] - 2)', replace: 'sound(pattern[step], 2)' },
      { label: 'Double time', find: 'var TEMPOS = [12, 10, 9, 8, 7, 6];', replace: 'var TEMPOS = [6, 5, 5, 4, 4, 3];' },
    ],
  },
  {
    id: 'pixel-paint',
    title: 'Pixel Paint',
    blurb: 'Draw 16 × 12 pixel art with the stylus. The top screen hangs it in a frame.',
    color: '#ffd43b',
    controls: [
      { input: 'Stylus', action: 'Paint' },
      { input: 'L R', keys: 'Q E', action: 'Change color' },
      { input: 'X', keys: 'C', action: 'Fill mode' },
      { input: 'Y', keys: 'V', action: 'Undo' },
    ],
    tweaks: [
      { label: 'Grid on', find: 'filling = false;\n      grid = false;', replace: 'filling = false;\n      grid = true;' },
      { label: 'Night palette', find: 'var PALETTE = [0xF8F9FA, 0x212529, 0xD6008F, 0xFF8CC6, 0x339AF0, 0xFFD43B, 0x51CF66, 0xFF922B];', replace: 'var PALETTE = [0x14162B, 0xF8F9FA, 0xFF4FB8, 0x9775FA, 0x22B8CF, 0xFFE066, 0x8CE99A, 0xFF8787];' },
    ],
  },
  {
    id: 'dual-screen',
    title: 'Playground',
    blurb: 'Move the orb, hop, and tap the lower screen to teleport. Measured in melonDS.',
    color: '#d6008f',
    measured: true,
    controls: [
      { input: '◀ ▶', keys: 'Arrows', action: 'Move' },
      { input: 'A', keys: 'Z', action: 'Jump' },
      { input: 'B', keys: 'X', action: 'Change color' },
      { input: 'Stylus', action: 'Teleport' },
    ],
    tweaks: [
      { label: 'Moon gravity', find: 'player.vy += 0.32;', replace: 'player.vy += 0.1;' },
      { label: 'Super jump', find: 'player.vy = -5.8;', replace: 'player.vy = -9;' },
      { label: 'Fast orb', find: 'nds.input.dx() * 2', replace: 'nds.input.dx() * 5' },
    ],
  },
];
