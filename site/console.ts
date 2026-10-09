import { Framebuffer, SCREEN_HEIGHT, SCREEN_WIDTH, TOP_QUAD_LIMIT } from '../sdk/framebuffer.js';
import { buttonName, toneArguments } from '../sdk/runtime-validation.js';

/** A compiled game, ready to boot. `script` is the exact game.js text. */
export interface Program {
  script: string;
  /** The same script bundled as a function, used where the page cannot evaluate code. */
  boot?: (nds: NDSRuntime, watchdog: () => void) => NDSGame;
  /** Loop checks injected into code edited on the page; see editor.ts. */
  watchdog?: Watchdog;
}

export interface Watchdog {
  /** Starts a callback's time budget; the native runtime allows 500 ms to boot and 100 ms per callback. */
  reset(milliseconds?: number): void;
  check(): void;
}

export interface ConsoleStats {
  frame: number;
  ticksPerSecond: number;
  updateMicros: number;
  drawMicros: number;
  quads: number;
}

/** Draws into both framebuffers for one tick; returns false when finished. */
export type Firmware = (top: Framebuffer, bottom: Framebuffer, tick: number, input: { touched: boolean; pressed: boolean }) => boolean;

interface ConsoleEvents {
  stats?(stats: ConsoleStats): void;
  error?(message: string): void;
  booted?(): void;
}

type Mode = 'off' | 'firmware' | 'game' | 'error';

export class BrowserConsole {
  readonly top = new Framebuffer(true, new Uint32Array(SCREEN_WIDTH * SCREEN_HEIGHT));
  readonly bottom = new Framebuffer(false, new Uint32Array(SCREEN_WIDTH * SCREEN_HEIGHT));
  readonly held = new Set<NDSButton>();
  /** Start-up screens belong to the page, not to a game, so they skip the quad budget. */
  private readonly firmwareTop = new Framebuffer(false, this.top.pixels);
  mode: Mode = 'off';
  paused = false;

  private readonly topImage: ImageData;
  private readonly bottomImage: ImageData;
  private readonly sources = new Map<string, NDSButton>();
  private readonly frameHeld = new Set<NDSButton>();
  private readonly hits = new Set<NDSButton>();
  private readonly releases = new Set<NDSButton>();
  private readonly pendingHits = new Set<NDSButton>();
  private readonly pendingReleases = new Set<NDSButton>();
  private readonly touch = { x: 0, y: 0, down: false, pressed: false, released: false };
  private readonly pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
  private readonly stats = { heapBytes: 0, heapPeakBytes: 0, updateMicros: 0, drawMicros: 0 };
  private readonly runtime: NDSRuntime & { frame: number };
  private game: NDSGame | null = null;
  private program: Program | null = null;
  private firmware: Firmware | null = null;
  private firmwareTick = 0;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: OscillatorNode | null = null;
  private volume = 0.7;
  private soundOn = false;
  private accumulator = 0;
  private last = 0;
  private dirty = true;
  private gameFrame = 0;
  private tickTimes: number[] = [];

  constructor(
    private readonly canvases: { top: HTMLCanvasElement; bottom: HTMLCanvasElement } | null,
    private readonly events: ConsoleEvents = {},
  ) {
    this.topImage = new ImageData(new Uint8ClampedArray(this.top.pixels.buffer), SCREEN_WIDTH, SCREEN_HEIGHT);
    this.bottomImage = new ImageData(new Uint8ClampedArray(this.bottom.pixels.buffer), SCREEN_WIDTH, SCREEN_HEIGHT);
    const held = this.frameHeld;
    this.runtime = {
      width: 256,
      height: 192,
      frame: 0,
      input: {
        down: (button) => held.has(buttonName(button)),
        hit: (button) => this.hits.has(buttonName(button)),
        up: (button) => this.releases.has(buttonName(button)),
        dx: () => Number(held.has('right')) - Number(held.has('left')),
        dy: () => Number(held.has('down')) - Number(held.has('up')),
      },
      touch: this.touch,
      top: this.top,
      bottom: this.bottom,
      stats: this.stats,
      audio: { tone: (frequency, frames, volume) => this.tone(frequency, frames, volume) },
    };
    this.powerOff();
  }

  /** Shows `firmware` first, if given, then boots `program`. */
  insert(program: Program, firmware: Firmware | null = null): void {
    this.program = program;
    this.game = null;
    this.firmware = firmware;
    this.firmwareTick = 0;
    this.silence();
    this.resetInput();
    if (firmware) this.mode = 'firmware';
    else this.boot();
    this.dirty = true;
  }

  restart(): void {
    if (this.program) this.insert(this.program);
  }

  powerOff(): void {
    this.mode = 'off';
    this.game = null;
    this.silence();
    this.top.pixels.fill(0xFF1A1E1D);
    this.bottom.pixels.fill(0xFF1A1E1D);
    this.dirty = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.silence();
      this.resetInput();
    }
  }

  /** Holds `button` for an input source such as a key code or pointer id. */
  press(source: string, button: NDSButton | null): void {
    if (button) this.sources.set(source, button);
    else this.sources.delete(source);
    const previous = new Set(this.held);
    this.held.clear();
    for (const active of this.sources.values()) this.held.add(active);
    for (const active of this.held) if (!previous.has(active)) this.pendingHits.add(active);
    for (const active of previous) if (!this.held.has(active)) this.pendingReleases.add(active);
  }

  releaseAll(): void {
    for (const source of [...this.sources.keys()]) this.press(source, null);
    if (this.pointer.down) this.touchEnd();
  }

  touchStart(x: number, y: number): void {
    this.touchMove(x, y);
    this.pointer.down = true;
    this.pointer.pressed = true;
  }

  touchMove(x: number, y: number): void {
    this.pointer.x = Math.max(0, Math.min(SCREEN_WIDTH - 1, Math.round(x)));
    this.pointer.y = Math.max(0, Math.min(SCREEN_HEIGHT - 1, Math.round(y)));
  }

  touchEnd(): void {
    if (!this.pointer.down) return;
    this.pointer.down = false;
    this.pointer.released = true;
  }

  async enableSound(): Promise<void> {
    this.audio ??= new AudioContext();
    if (!this.master) {
      this.master = this.audio.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.audio.destination);
    }
    await this.audio.resume();
    this.soundOn = true;
  }

  disableSound(): void {
    this.soundOn = false;
    this.silence();
  }

  get soundEnabled(): boolean {
    return this.soundOn;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.audio) this.master.gain.setTargetAtTime(volume, this.audio.currentTime, 0.02);
  }

  /** Advances the fixed 60 Hz simulation; call from requestAnimationFrame. */
  frame(now: number): void {
    const elapsed = this.last ? Math.min(now - this.last, 100) : 0;
    this.last = now;
    if (!this.paused && (this.mode === 'game' || this.mode === 'firmware')) {
      this.accumulator += elapsed;
      while (this.accumulator >= 1000 / 60) {
        this.accumulator -= 1000 / 60;
        this.tick();
        this.tickTimes.push(now);
      }
    } else {
      this.accumulator = 0;
    }
    if (this.dirty) this.present();
  }

  /** Runs `ticks` frames with no input and no sound, as fast as possible. */
  fastForward(ticks: number): void {
    for (let tick = 0; tick < ticks && (this.mode === 'game' || this.mode === 'firmware'); tick++) this.tick();
    this.present();
  }

  present(): void {
    this.dirty = false;
    if (!this.canvases) return;
    this.canvases.top.getContext('2d')!.putImageData(this.topImage, 0, 0);
    this.canvases.bottom.getContext('2d')!.putImageData(this.bottomImage, 0, 0);
  }

  private tick(): void {
    this.frameHeld.clear();
    for (const button of this.held) this.frameHeld.add(button);
    this.hits.clear();
    this.releases.clear();
    for (const button of this.pendingHits) this.hits.add(button);
    for (const button of this.pendingReleases) this.releases.add(button);
    this.pendingHits.clear();
    this.pendingReleases.clear();
    this.touch.x = this.pointer.x;
    this.touch.y = this.pointer.y;
    this.touch.down = this.pointer.down;
    this.touch.pressed = this.pointer.pressed;
    this.touch.released = this.pointer.released;
    this.pointer.pressed = false;
    this.pointer.released = false;
    this.dirty = true;

    if (this.mode === 'firmware') {
      this.top.beginFrame();
      const input = { touched: this.touch.pressed, pressed: this.hits.size > 0 };
      if (!this.firmware!(this.firmwareTop, this.bottom, this.firmwareTick++, input)) this.boot();
      return;
    }
    const game = this.game!;
    const watchdog = this.program?.watchdog;
    this.runtime.frame = this.gameFrame;
    this.top.beginFrame();
    const started = performance.now();
    try {
      watchdog?.reset();
      game.update();
    } catch (error) {
      this.fail('update', error);
      return;
    }
    const drawn = performance.now();
    try {
      watchdog?.reset();
      game.draw();
    } catch (error) {
      this.fail('draw', error);
      return;
    }
    const finished = performance.now();
    if (this.top.overflowed) {
      this.fail('draw', `top hardware renderer exceeded ${TOP_QUAD_LIMIT} quads`);
      return;
    }
    this.stats.updateMicros = Math.round((drawn - started) * 1000);
    this.stats.drawMicros = Math.round((finished - drawn) * 1000);
    this.gameFrame += 1;
    if (this.gameFrame % 15 === 0) this.report();
  }

  private report(): void {
    const now = performance.now();
    this.tickTimes = this.tickTimes.filter((time) => now - time < 1000);
    this.events.stats?.({
      frame: this.gameFrame,
      ticksPerSecond: this.tickTimes.length,
      updateMicros: this.stats.updateMicros,
      drawMicros: this.stats.drawMicros,
      quads: this.top.quads,
    });
  }

  private boot(): void {
    const program = this.program;
    if (!program) return;
    this.firmware = null;
    this.mode = 'game';
    this.gameFrame = 0;
    this.runtime.frame = 0;
    this.stats.updateMicros = 0;
    this.stats.drawMicros = 0;
    this.top.beginFrame();
    this.bottom.pixels.fill(0xFF000000);
    let game: NDSGame;
    try {
      program.watchdog?.reset(500);
      game = this.instantiate(program);
      if (typeof game !== 'object' || game === null) throw new TypeError('Script must define global game with update() and draw()');
      for (const method of ['update', 'draw'] as const) {
        if (typeof game[method] !== 'function') throw new TypeError(`game.${method} must be a function`);
      }
      game.init?.call(game);
    } catch (error) {
      this.fail('boot', error);
      return;
    }
    this.game = game;
    this.events.booted?.();
  }

  private instantiate(program: Program): NDSGame {
    const watchdog = program.watchdog ? () => program.watchdog!.check() : () => {};
    let factory: (nds: NDSRuntime, watchdog: () => void) => NDSGame;
    try {
      // The same bytes the ROM embeds, evaluated as one global script.
      factory = new Function('nds', '__nds_watchdog', `${program.script}\nreturn game;`) as typeof factory;
    } catch (error) {
      // A page whose content policy forbids evaluation still runs bundled games.
      if (!program.boot || error instanceof SyntaxError) throw error;
      factory = program.boot;
    }
    return factory(this.runtime, watchdog);
  }

  /** Mirrors errorScreen() in native/main.cpp. */
  private fail(where: string, error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const message = `${where}: ${detail}`;
    this.mode = 'error';
    this.game = null;
    this.silence();
    const top = this.firmwareTop;
    const bottom = this.bottom;
    top.clear(0x291C32);
    top.text('NDS-TS SCRIPT ERROR', 12, 12, 0xFF718C);
    top.text('FIX YOUR TYPESCRIPT AND REBUILD', 12, 24, 0xFFFFFF);
    let x = 12;
    let y = 42;
    const printable = message.replace(/[^\n\x20-\x7E]/g, '?');
    for (let index = 0; index < printable.length && y < 180 && index < 100; index++) {
      const character = printable[index];
      if (character === '\n' || x > 240) {
        x = 12;
        y += 8;
      }
      if (character !== '\n') {
        top.text(character, x, y, 0xFFFFFF);
        x += 4;
      }
    }
    bottom.clear(0x181C2B);
    bottom.text('THE GAME HAS STOPPED SAFELY', 12, 16, 0xFFFFFF);
    bottom.text('FULL DIAGNOSTIC: BELOW THE CONSOLE', 12, 28, 0x91A4BC);
    this.dirty = true;
    this.events.error?.(message);
  }

  private tone(frequency: number, frames: number, volume?: number): void {
    const [hz, length, level] = toneArguments(frequency, frames, volume);
    if (!this.soundOn || !this.audio || !this.master || this.paused) return;
    const oscillator = this.audio.createOscillator();
    const gain = this.audio.createGain();
    const now = this.audio.currentTime;
    const end = now + length / 60;
    this.voice?.stop(now);
    this.voice = oscillator;
    oscillator.type = 'square';
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(level * 0.12, now);
    gain.gain.setTargetAtTime(0, Math.max(now, end - 0.01), 0.003);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(end);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (this.voice === oscillator) this.voice = null;
    };
  }

  private silence(): void {
    try {
      this.voice?.stop();
    } catch {
      // Already stopped.
    }
    this.voice = null;
  }

  private resetInput(): void {
    this.sources.clear();
    this.held.clear();
    this.frameHeld.clear();
    this.hits.clear();
    this.releases.clear();
    this.pendingHits.clear();
    this.pendingReleases.clear();
    Object.assign(this.pointer, { down: false, pressed: false, released: false });
    Object.assign(this.touch, { x: 0, y: 0, down: false, pressed: false, released: false });
  }
}
