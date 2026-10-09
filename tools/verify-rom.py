#!/usr/bin/env python3
"""Assert the standalone demo really responds inside a Nintendo DS emulator.

Install Pillow, supply a DS libretro core, and run:
  python3 tools/verify-rom.py build/nds-ts-demo.nds --core /path/to/melonds_libretro.dylib

The check measures sprite movement, jumping, touch relocation, and non-silent
audio. Captures, a WAV, and a JSON report are written only inside this project.
No emulator core or firmware is downloaded by this tool.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "tests"))
from libretro_runner import Runner  # noqa: E402


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def crc16(data):
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def verify_header(rom):
    data = rom.read_bytes()
    require(len(data) >= 0x200, "ROM is smaller than its Nintendo DS header")
    arm9_offset, arm9_size = struct.unpack_from("<I", data, 0x20)[0], struct.unpack_from("<I", data, 0x2C)[0]
    arm7_offset, arm7_size = struct.unpack_from("<I", data, 0x30)[0], struct.unpack_from("<I", data, 0x3C)[0]
    for name, offset, size in (("ARM9", arm9_offset, arm9_size), ("ARM7", arm7_offset, arm7_size)):
        require(offset >= 0x200 and size > 0 and offset + size <= len(data),
                f"{name} binary range is outside the ROM")
    actual_crc = struct.unpack_from("<H", data, 0x15E)[0]
    require(actual_crc == crc16(data[:0x15E]), "Nintendo DS ROM header CRC16 does not match")
    return {"bytes": len(data), "title": data[:12].rstrip(b"\0").decode("ascii", errors="replace"),
            "arm9_bytes": arm9_size, "arm7_bytes": arm7_size, "header_crc16": actual_crc}


def orb_position(image):
    """Locate the magenta orb; omit the header stripe and floor border."""
    require(image.size == (256, 384), f"Expected two 256x192 screens, got {image.size}")
    points = []
    pixels = image.load()
    for y in range(40, 154):
        for x in range(256):
            red, green, blue = pixels[x, y]
            if 200 <= red <= 222 and green <= 12 and 128 <= blue <= 149:
                points.append((x, y))
    require(len(points) >= 20, f"Could not identify the demo orb ({len(points)} magenta pixels)")
    # Other foreground magenta regions would invalidate a centroid assertion.
    min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
    min_y, max_y = min(p[1] for p in points), max(p[1] for p in points)
    require(max_x - min_x <= 16 and max_y - min_y <= 16, "Magenta pixels do not form one 16x16 orb")
    return {"x": round(sum(p[0] for p in points) / len(points), 3),
            "y": round(sum(p[1] for p in points) / len(points), 3),
            "pixels": len(points), "bounds": [min_x, min_y, max_x, max_y]}


def audio_stats(data):
    samples = [sample[0] for sample in struct.iter_unpack("<h", data)]
    require(samples, "Emulator emitted no audio samples")
    return {"samples": len(samples), "nonzero_samples": sum(sample != 0 for sample in samples),
            "peak": max(abs(sample) for sample in samples),
            "rms": round(math.sqrt(sum(sample * sample for sample in samples) / len(samples)), 3)}


def tone_frequency(data, sample_rate):
    left = [pair[0] for pair in struct.iter_unpack("<hh", data)]
    active = [index for index, value in enumerate(left) if abs(value) > 100]
    require(len(active) >= 100, "Tone does not contain enough active PCM samples to measure pitch")
    segment = left[active[0]:active[-1] + 1]
    mean = sum(segment) / len(segment)
    crossings = sum((segment[index - 1] >= mean) != (segment[index] >= mean)
                    for index in range(1, len(segment)))
    return round(crossings * sample_rate / (2 * len(segment)), 3)


def movement_measurement(delta_x, game_frames, speed, held_frames=30, settle_frames=3):
    """Measure settled motion separately from the simulation's clock rate.

    Release frames drain input sampling and the top GPU's geometry swap before
    capturing motion. They must advance the clock but must not move the orb.
    """
    expected_pixels = held_frames * speed
    emulated_frames = held_frames + settle_frames
    return {"correct_motion": abs(delta_x - expected_pixels) <= 1,
            "full_rate": abs(game_frames - emulated_frames) <= 1,
            "expected_pixels": expected_pixels, "held_frames": held_frames,
            "release_settle_frames": settle_frames, "emulated_frames": emulated_frames}


def read_hud(image):
    """Read the demo's original 3x5 font, so game frames need not equal VBlanks."""
    font_path = ROOT / "gen" / "font_gen.h"
    require(font_path.is_file(), "Generate the game first; gen/font_gen.h is required for HUD measurement")
    glyphs = {int(code): int(bits, 16) for code, bits in
              re.findall(r"\{\s*(\d+),\s*0x([0-9a-fA-F]+)\s*\}", font_path.read_text())}
    # The compact font intentionally shares M/N shapes. These known HUD labels
    # avoid ambiguity while every numerical glyph remains independently read.
    alphabet = " 0123456789FRAMEHPKUDTSWOC"
    decoder = {glyphs[ord(character)]: character for character in alphabet}
    pixels = image.load()

    def line(y, screen=1):
        text = ""
        for x in range(12, 252, 4):
            bits = 0
            for row in range(5):
                for column in range(3):
                    color = pixels[x + column, screen * 192 + y + row]
                    if min(color) < 140:
                        bits |= 1 << (row * 3 + column)
            text += decoder.get(bits, "?")
        return text.rstrip()

    frame_line, update_line, draw_line = line(161), line(172), line(182)
    counters_line = line(178, screen=0)
    frame = re.fullmatch(r"FRAME (\d+)\s+HEAP (\d+)K", frame_line)
    update = re.fullmatch(r"UPDATE (\d+)US", update_line)
    draw = re.fullmatch(r"DRAW\s+(\d+)US", draw_line)
    counters = re.fullmatch(r"HOPS (\d+)\s+TOUCHES (\d+)", counters_line)
    require(frame and update and draw and counters,
            f"Could not read runtime HUD: {frame_line!r}, {update_line!r}, {draw_line!r}, {counters_line!r}")
    return {"game_frame": int(frame.group(1)), "heap_kib_rounded": int(frame.group(2)),
            "update_micros": int(update.group(1)), "draw_micros": int(draw.group(1)),
            "hops": int(counters.group(1)), "touches": int(counters.group(2))}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--core", default=os.environ.get("NDS_LIBRETRO_CORE"),
                        help="Already installed DS libretro core (or set NDS_LIBRETRO_CORE)")
    parser.add_argument("--out", type=Path, default=ROOT / "captures" / "demo")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache" / "libretro")
    parser.add_argument("--boot-frames", type=int, default=180)
    parser.add_argument("--expected-speed", type=float, default=2,
                        help="Expected horizontal pixels per game frame (1..3; supports TS-only speed-change proof)")
    parser.add_argument("--diagnostic", action="store_true",
                        help="Continue other checks after a missed 60 Hz target; report and exit remain failed")
    args = parser.parse_args()
    if not args.core:
        parser.error("--core or NDS_LIBRETRO_CORE is required; this tool never downloads an emulator")
    if args.boot_frames < 1:
        parser.error("--boot-frames must be positive")
    if not 1 <= args.expected_speed <= 3:
        parser.error("--expected-speed must be in 1..3 so RIGHT30 stays inside the demo playfield")
    rom = args.rom.resolve()
    require(rom.is_file(), f"ROM does not exist: {rom}")
    require(Path(args.core).is_file(), f"libretro core does not exist: {args.core}")
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / "report.json"
    # A failed rerun must not leave behind a previous successful report.
    report_path.unlink(missing_ok=True)
    report = {"rom": str(rom), "header": verify_header(rom), "checks": []}
    started = time.monotonic()
    with Runner(args.core, rom, args.out, args.cache) as runner:
        report["core"] = {"name": runner.core_name, "version": runner.core_version,
                          "fps": runner.fps, "sample_rate": runner.sample_rate}
        runner.step(args.boot_frames)
        boot_image = runner.shot("01-boot")
        boot, boot_hud = orb_position(boot_image), read_hud(boot_image)
        require(abs(boot["x"] - 127.5) < 4, f"Unexpected starting orb position: {boot}")
        runner.buttons.add("RIGHT")
        runner.step(30)
        runner.buttons.clear()
        # Input sampling and the top GPU each introduce presentation latency.
        # Wait through release rather than accepting a speed-dependent error.
        runner.step(3)
        moved_image = runner.shot("02-right")
        moved, moved_hud = orb_position(moved_image), read_hud(moved_image)
        delta_x = moved["x"] - boot["x"]
        game_frames = moved_hud["game_frame"] - boot_hud["game_frame"]
        measurement = movement_measurement(delta_x, game_frames, args.expected_speed)
        if not args.diagnostic:
            require(measurement["correct_motion"],
                    f"Settled RIGHT30 should move {measurement['expected_pixels']} px, measured {delta_x} px")
        full_rate = measurement["full_rate"]
        if not args.diagnostic:
            require(full_rate,
                    f"60 Hz target missed: 33 VBlanks advanced {game_frames} native frames; runtime HUD {moved_hud}")
        report["checks"].append({"name": "right_moves_player_at_60_hz",
                                 "passed": full_rate and measurement["correct_motion"],
                                 "before": boot, "after": moved, "delta_x": round(delta_x, 3),
                                 "pixels_per_game_frame": args.expected_speed,
                                 "game_frames": game_frames, **measurement})
        report["runtime_hud"] = {"boot": boot_hud, "after_right": moved_hud,
                                 "observed_game_fps": round(game_frames * runner.fps / measurement["emulated_frames"], 3)}
        audio_start = len(runner.audio)
        runner.buttons.add("A")
        runner.step(2)
        runner.buttons.clear()
        runner.step(6)
        jumped = orb_position(runner.shot("03-jump"))
        delta_y = moved["y"] - jumped["y"]
        require(delta_y > 12, f"A should launch the player upward, measured {delta_y} px")
        runner.step(12)
        action_audio = audio_stats(runner.audio[audio_start:])
        require(action_audio["nonzero_samples"] > 100 and action_audio["peak"] > 100,
                f"A did not produce the expected audible tone: {action_audio}")
        action_audio["frequency_hz"] = tone_frequency(runner.audio[audio_start:], runner.sample_rate)
        require(620 <= action_audio["frequency_hz"] <= 700,
                f"A should play a 660 Hz tone; measured {action_audio['frequency_hz']} Hz")
        report["checks"].append({"name": "a_jumps_and_plays_audio", "passed": True,
                                 "position": jumped, "upward_pixels": round(delta_y, 3),
                                 "audio": action_audio})
        runner.touch = (60, 80)
        before_touch = read_hud(runner.image())["touches"]
        touch_latency = 0
        while touch_latency < 12:
            runner.step(1)
            touch_latency += 1
            if read_hud(runner.image())["touches"] > before_touch:
                break
        touched_image = runner.shot("04-touch")
        touched, touched_hud = orb_position(touched_image), read_hud(touched_image)
        require(touched_hud["touches"] == before_touch + 1,
                f"Touch event was not delivered within 12 VBlanks; runtime HUD {touched_hud}")
        require(abs(touched["x"] - 59.5) < 4 and abs(touched["y"] - 81) < 5,
                f"Touch60,80 should relocate the orb near that point, measured {touched}")
        report["checks"].append({"name": "touch_relocates_player", "passed": True,
                                 "touch": [60, 80], "position": touched,
                                 "latency_emulated_frames": touch_latency})
        report["runtime_hud"]["after_touch"] = touched_hud
        runner.touch = None
        runner.step(1)
        runner.save_audio()
        report["frames"] = runner.frame
        report["full_audio"] = audio_stats(runner.audio)
    report["passed"] = all(check["passed"] for check in report["checks"])
    report["seconds"] = round(time.monotonic() - started, 3)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    print(f"Captures and audio: {args.out.resolve()}")
    if not report["passed"]:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, RuntimeError) as error:
        print(f"ROM verification failed: {error}", file=sys.stderr)
        sys.exit(1)
