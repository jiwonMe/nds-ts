/** Ambient game API shared by the Nintendo DS runtime and browser preview. */
type NDSButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select';

interface NDSInput {
  /** True for every frame the button is held. */
  down(button: NDSButton): boolean;
  /** True on the first frame of a press. */
  hit(button: NDSButton): boolean;
  /** True on the first frame after release. */
  up(button: NDSButton): boolean;
  /** Horizontal D-pad axis, -1 / 0 / 1. */
  dx(): number;
  /** Vertical D-pad axis, -1 / 0 / 1. */
  dy(): number;
}

interface NDSTouch {
  /** Last position on the bottom screen, in 256 × 192 pixels. */
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
}

interface NDSScreen {
  /** Colors are integer 0x000000..0xFFFFFF. All coordinates/dimensions must be
   * finite -32768..32767 numbers, rounded to pixels with Math.round(). */
  clear(color: number): void;
  rect(x: number, y: number, width: number, height: number, color: number): void;
  /** Printable ASCII + newline only, at most 1024 bytes per call. Built-in 3 × 5
   * uppercase font. Advance: 4 pixels; newline: 7 pixels. */
  text(text: string, x: number, y: number, color: number): void;
  /** v0.1 provides one original 16 × 16 sprite, named 'orb'. */
  sprite(name: 'orb', x: number, y: number): void;
}

interface NDSStats {
  /** Duktape heap usage, excluding engine/framebuffer allocations. Zero in browser. */
  readonly heapBytes: number;
  readonly heapPeakBytes: number;
  /** Previous frame's callbacks, in microseconds. */
  readonly updateMicros: number;
  readonly drawMicros: number;
}

interface NDSRuntime {
  readonly width: 256;
  readonly height: 192;
  readonly frame: number;
  readonly input: NDSInput;
  readonly touch: NDSTouch;
  readonly top: NDSScreen;
  readonly bottom: NDSScreen;
  readonly stats: NDSStats;
  readonly audio: {
    /** Frequency: finite 40..4000 Hz, truncated to integer. Duration: integer
     * 1..600 frames at 60 Hz. Volume: finite 0..1. Invalid arguments throw. */
    tone(frequency: number, frames: number, volume?: number): void;
  };
}

interface NDSGame {
  init?(): void;
  /** Runs once per frame before draw(). Keep persistent state outside this method. */
  update(): void;
  /** Redraw both screens every frame. */
  draw(): void;
}

declare var nds: NDSRuntime;
