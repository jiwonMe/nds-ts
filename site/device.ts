import type { BrowserConsole } from './console.js';

const KEYS: Record<string, NDSButton> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Space: 'a', KeyX: 'b', KeyC: 'x', KeyV: 'y',
  KeyQ: 'l', KeyE: 'r', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select',
};
// Standard gamepad buttons by position, so the right face button is A as on a DS.
const PAD: [number, NDSButton][] = [
  [0, 'b'], [1, 'a'], [2, 'y'], [3, 'x'], [4, 'l'], [5, 'r'], [8, 'select'], [9, 'start'],
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
];

/** Connects the handheld's DOM to the console: buttons, D-pad, touchscreen,
 * keyboard while the handheld has focus, and any connected gamepad. */
export class Device {
  private readonly buttons: HTMLElement[];
  private readonly pressed = new Set<NDSButton>();
  private readonly padState = new Map<string, NDSButton>();

  constructor(
    readonly root: HTMLElement,
    private readonly console: BrowserConsole,
    onFocus: (active: boolean) => void,
  ) {
    this.buttons = [...root.querySelectorAll<HTMLElement>('[data-button]')];
    for (const button of this.buttons) if (!button.closest('.ds-dpad')) this.bindButton(button);
    this.bindDpad(root.querySelector<HTMLElement>('.ds-dpad')!);
    this.addTouchSurface(root.querySelector<HTMLCanvasElement>('#screen-bottom')!, root);
    this.addKeyboardTarget(root, onFocus);
    root.addEventListener('pointerdown', () => root.focus({ preventScroll: true }));
    window.addEventListener('blur', () => console.releaseAll());
  }

  /** Called every animation frame: gamepads in, pressed styles out. */
  frame(): void {
    this.pollGamepads();
    const held = this.console.held;
    if (held.size === this.pressed.size && [...held].every((button) => this.pressed.has(button))) return;
    this.pressed.clear();
    for (const button of held) this.pressed.add(button);
    for (const element of this.buttons) {
      element.toggleAttribute('data-pressed', held.has(element.dataset.button as NDSButton));
    }
    const dpad = this.root.querySelector<HTMLElement>('.ds-dpad')!;
    const tiltX = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
    const tiltY = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    dpad.style.setProperty('--tilt', `rotateX(${tiltX * 9}deg) rotateY(${tiltY * 9}deg)`);
  }

  private bindButton(element: HTMLElement): void {
    const name = element.dataset.button as NDSButton;
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      this.console.press(`pointer:${event.pointerId}`, name);
      this.root.focus({ preventScroll: true });
    });
    const release = (event: PointerEvent) => this.console.press(`pointer:${event.pointerId}`, null);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** One pointer drives both axes, so sliding a thumb across gives diagonals. */
  private bindDpad(dpad: HTMLElement): void {
    let pointer: number | null = null;
    const steer = (event: PointerEvent) => {
      const bounds = dpad.getBoundingClientRect();
      const dx = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      const dy = (event.clientY - bounds.top) / bounds.height * 2 - 1;
      this.console.press('dpad:x', dx > 0.3 ? 'right' : dx < -0.3 ? 'left' : null);
      this.console.press('dpad:y', dy > 0.3 ? 'down' : dy < -0.3 ? 'up' : null);
    };
    const release = () => {
      pointer = null;
      this.console.press('dpad:x', null);
      this.console.press('dpad:y', null);
    };
    dpad.addEventListener('pointerdown', (event) => {
      if (pointer !== null || event.button !== 0) return;
      event.preventDefault();
      pointer = event.pointerId;
      dpad.setPointerCapture(event.pointerId);
      this.root.focus({ preventScroll: true });
      steer(event);
    });
    dpad.addEventListener('pointermove', (event) => { if (event.pointerId === pointer) steer(event); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      dpad.addEventListener(type, (event) => { if (event.pointerId === pointer) release(); });
    }
    dpad.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Any canvas showing the bottom screen can act as the touchscreen. */
  addTouchSurface(canvas: HTMLCanvasElement, focusTarget: HTMLElement): void {
    let pointer: number | null = null;
    const position = (event: PointerEvent): [number, number] => {
      const bounds = canvas.getBoundingClientRect();
      return [(event.clientX - bounds.left) / bounds.width * 256, (event.clientY - bounds.top) / bounds.height * 192];
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (pointer !== null || event.button !== 0) return;
      event.preventDefault();
      pointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      focusTarget.focus({ preventScroll: true });
      this.console.touchStart(...position(event));
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointer) this.console.touchMove(...position(event));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, (event) => {
        if (event.pointerId !== pointer) return;
        pointer = null;
        this.console.touchEnd();
      });
    }
  }

  /** Keys reach the console only while `root` has focus, so the page still scrolls normally. */
  addKeyboardTarget(root: HTMLElement, onFocus: (active: boolean) => void): void {
    root.addEventListener('keydown', (event) => {
      const button = KEYS[event.code];
      if (!button || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) this.console.press(`key:${event.code}`, button);
    });
    root.addEventListener('keyup', (event) => {
      if (!KEYS[event.code]) return;
      event.preventDefault();
      this.console.press(`key:${event.code}`, null);
    });
    root.addEventListener('focusin', () => onFocus(true));
    root.addEventListener('focusout', (event) => {
      if (root.contains(event.relatedTarget as Node | null)) return;
      for (const code of Object.keys(KEYS)) this.console.press(`key:${code}`, null);
      onFocus(false);
    });
  }

  private pollGamepads(): void {
    if (!navigator.getGamepads) return;
    const seen = new Set<string>();
    for (const pad of navigator.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const set = (button: NDSButton, on: boolean) => {
        const source = `pad${pad.index}:${button}`;
        if (on) seen.add(source);
        if (on !== this.padState.has(source)) {
          if (on) this.padState.set(source, button);
          else this.padState.delete(source);
          this.console.press(source, on ? button : null);
        }
      };
      for (const [index, button] of PAD) {
        const stick = button === 'left' ? pad.axes[0] < -0.5 : button === 'right' ? pad.axes[0] > 0.5
          : button === 'up' ? pad.axes[1] < -0.5 : button === 'down' ? pad.axes[1] > 0.5 : false;
        set(button, Boolean(pad.buttons[index]?.pressed) || stick);
      }
    }
    for (const [source] of this.padState) {
      if (!seen.has(source)) {
        this.padState.delete(source);
        this.console.press(source, null);
      }
    }
  }
}

/** Sizes the handheld so one DS pixel covers whole device pixels when it can. */
export function fitDevice(host: HTMLElement, root: HTMLElement, frame: HTMLElement): void {
  const style = getComputedStyle(frame);
  const width = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const stacked = window.matchMedia('(max-width: 1080px)').matches;
  const available = stacked ? width : width * 0.5;
  const wide = available >= 368 * 1.12;
  const units = wide ? { width: 368, height: 482 } : { width: 280, height: 540 };
  let scale = available / units.width;
  // Leave room for the sticky navigation and the hero's top padding.
  if (!stacked) scale = Math.min(scale, (window.innerHeight - 136) / units.height);
  scale = Math.min(scale, stacked ? 1.75 : 2.25);
  const ratio = window.devicePixelRatio || 1;
  const snapped = Math.floor(scale * ratio) / ratio;
  if (snapped >= scale * 0.9) scale = snapped;
  scale = Math.max(scale, 0.7);
  host.style.setProperty('--px', scale.toFixed(4));
  root.dataset.layout = wide ? 'wide' : 'compact';
}
