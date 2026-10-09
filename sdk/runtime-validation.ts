/** Native binding limits, mirrored by the browser so preview errors match the ROM. */
function requireNumber(value: number): void {
  if (typeof value !== 'number') throw new TypeError('number required');
}

export function coordinate(value: number): number {
  requireNumber(value);
  if (!Number.isFinite(value) || value < -32768 || value > 32767) {
    throw new RangeError('coordinate must be finite and within -32768..32767');
  }
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

export function color(value: number): number {
  requireNumber(value);
  if (!Number.isFinite(value) || value < 0 || value > 0xFFFFFF || !Number.isInteger(value)) {
    throw new RangeError('color must be an integer 0x000000..0xffffff');
  }
  return value;
}

export function toneArguments(frequency: number, frames: number, volume = 0.3): [number, number, number] {
  requireNumber(frequency);
  requireNumber(frames);
  requireNumber(volume);
  if (!Number.isFinite(frequency) || frequency < 40 || frequency > 4000 ||
      !Number.isFinite(frames) || frames < 1 || frames > 600 || !Number.isInteger(frames) ||
      !Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError('tone needs frequency 40..4000, frames 1..600, volume 0..1');
  }
  return [Math.trunc(frequency), frames, volume];
}

export function textBytes(value: string): number[] {
  if (typeof value !== 'string') throw new TypeError('string required');
  if (value.length > 1024) throw new RangeError('text is limited to 1024 bytes per call');
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const byte = value.charCodeAt(index);
    if (byte !== 10 && (byte < 32 || byte > 126)) {
      throw new RangeError('text supports printable ASCII and newline only');
    }
    bytes.push(byte);
  }
  return bytes;
}

export function buttonName(value: NDSButton): NDSButton {
  if (typeof value !== 'string') throw new TypeError('string required');
  if (!['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'].includes(value)) {
    throw new RangeError(`unknown button: ${value}`);
  }
  return value;
}

export function spriteName(value: 'orb'): 'orb' {
  if (typeof value !== 'string') throw new TypeError('string required');
  if (value !== 'orb') throw new RangeError(`unknown sprite: ${value}`);
  return value;
}
