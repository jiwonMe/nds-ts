"""Minimal, offline libretro driver used by the ROM integration check.

Supply an already installed Nintendo DS libretro core. This module never
downloads a core or writes outside the output/cache directories supplied by
the caller. It supports the usual top/bottom 256 x 384 DS screen layout.
"""
from __future__ import annotations

import ctypes as C
from pathlib import Path
import struct
import wave


BUTTONS = {
    "B": 0, "Y": 1, "SELECT": 2, "START": 3, "UP": 4, "DOWN": 5,
    "LEFT": 6, "RIGHT": 7, "A": 8, "X": 9, "L": 10, "R": 11,
}
OPTIONS = {
    "melonds_console_mode": "DS",
    "melonds_boot_directly": "Enabled",
    "melonds_screen_layout": "Top/Bottom",
    "melonds_screen_gap": "0",
    "melonds_touch_mode": "Touch",
    "melonds_threaded_renderer": "Disabled",
    "melonds_opengl_renderer": "Disabled",
    "melonds_randomize_mac_address": "Disabled",
    "melonds_dsi_sdcard": "Disabled",
    "melonds_jit_enable": "Disabled",
    "desmume_pointer_type": "touch",
    "desmume_screens_layout": "top/bottom",
    "desmume_screens_gap": "0",
}


class SystemInfo(C.Structure):
    _fields_ = [("library_name", C.c_char_p), ("library_version", C.c_char_p),
                ("valid_extensions", C.c_char_p), ("need_fullpath", C.c_bool),
                ("block_extract", C.c_bool)]


class Geometry(C.Structure):
    _fields_ = [("base_width", C.c_uint), ("base_height", C.c_uint),
                ("max_width", C.c_uint), ("max_height", C.c_uint),
                ("aspect_ratio", C.c_float)]


class Timing(C.Structure):
    _fields_ = [("fps", C.c_double), ("sample_rate", C.c_double)]


class AvInfo(C.Structure):
    _fields_ = [("geometry", Geometry), ("timing", Timing)]


class GameInfo(C.Structure):
    _fields_ = [("path", C.c_char_p), ("data", C.c_void_p),
                ("size", C.c_size_t), ("meta", C.c_char_p)]


class Variable(C.Structure):
    _fields_ = [("key", C.c_char_p), ("value", C.c_char_p)]


ENV = C.CFUNCTYPE(C.c_bool, C.c_uint, C.c_void_p)
VIDEO = C.CFUNCTYPE(None, C.c_void_p, C.c_uint, C.c_uint, C.c_size_t)
AUDIO = C.CFUNCTYPE(None, C.c_int16, C.c_int16)
AUDIO_BATCH = C.CFUNCTYPE(C.c_size_t, C.POINTER(C.c_int16), C.c_size_t)
POLL = C.CFUNCTYPE(None)
STATE = C.CFUNCTYPE(C.c_int16, C.c_uint, C.c_uint, C.c_uint, C.c_uint)


class Runner:
    def __init__(self, core: str | Path, rom: str | Path, outdir: str | Path,
                 cache_dir: str | Path, verbose: bool = False):
        self.outdir = Path(outdir).resolve()
        cache_dir = Path(cache_dir).resolve()
        self.outdir.mkdir(parents=True, exist_ok=True)
        for name in ("system", "saves"):
            (cache_dir / name).mkdir(parents=True, exist_ok=True)
        self.sysdir = C.create_string_buffer(str(cache_dir / "system").encode())
        self.savedir = C.create_string_buffer(str(cache_dir / "saves").encode())
        self.verbose = verbose
        self.buttons: set[str] = set()
        self.touch: tuple[int, int] | None = None
        self.frame = 0
        self.width = self.height = 0
        self.pixel_format = 0
        self.pixels: bytes | None = None
        self.audio = bytearray()
        self.variables: dict[str, list[str]] = {}
        self._keep = []
        self._closed = False
        self.lib = C.CDLL(str(Path(core).resolve()))
        self._callbacks = (
            ENV(self._environment), VIDEO(self._video), AUDIO(self._audio),
            AUDIO_BATCH(self._audio_batch), POLL(lambda: None), STATE(self._input),
        )
        for name, callback in zip(("environment", "video_refresh", "audio_sample",
                                   "audio_sample_batch", "input_poll", "input_state"),
                                  self._callbacks):
            function = getattr(self.lib, "retro_set_" + name)
            function.argtypes = [type(callback)]
            function.restype = None
            function(callback)
        for name in ("retro_init", "retro_run", "retro_unload_game", "retro_deinit"):
            getattr(self.lib, name).argtypes = []
            getattr(self.lib, name).restype = None
        self.lib.retro_get_system_info.argtypes = [C.POINTER(SystemInfo)]
        self.lib.retro_get_system_info.restype = None
        self.lib.retro_get_system_av_info.argtypes = [C.POINTER(AvInfo)]
        self.lib.retro_get_system_av_info.restype = None
        self.lib.retro_load_game.argtypes = [C.POINTER(GameInfo)]
        self.lib.retro_load_game.restype = C.c_bool
        self.lib.retro_init()
        info = SystemInfo()
        self.lib.retro_get_system_info(C.byref(info))
        self.core_name = (info.library_name or b"unknown").decode()
        self.core_version = (info.library_version or b"unknown").decode()
        rom = Path(rom).resolve()
        data = rom.read_bytes()
        self._rom_buffer = C.create_string_buffer(data, len(data))
        self._rom_path = str(rom).encode()
        game = GameInfo(self._rom_path, C.cast(self._rom_buffer, C.c_void_p), len(data), None)
        if not self.lib.retro_load_game(C.byref(game)):
            self.lib.retro_deinit()
            raise RuntimeError("libretro core could not load the ROM")
        av = AvInfo()
        self.lib.retro_get_system_av_info(C.byref(av))
        self.sample_rate = av.timing.sample_rate or 32768
        self.fps = av.timing.fps or 60

    def _environment(self, command, data):
        command &= 0xFFFF
        if command == 3:  # GET_CAN_DUPE
            C.cast(data, C.POINTER(C.c_bool))[0] = True
        elif command in (9, 31):  # GET_SYSTEM/SAVE_DIRECTORY
            directory = self.sysdir if command == 9 else self.savedir
            C.cast(data, C.POINTER(C.c_void_p))[0] = C.cast(directory, C.c_void_p).value
        elif command == 10:  # SET_PIXEL_FORMAT
            self.pixel_format = C.cast(data, C.POINTER(C.c_int))[0]
            return self.pixel_format in (0, 1, 2)
        elif command == 16:  # SET_VARIABLES
            variables = C.cast(data, C.POINTER(Variable))
            index = 0
            while variables[index].key:
                key = variables[index].key.decode()
                description = variables[index].value.decode()
                self.variables[key] = (description.split(";", 1)[1].strip().split("|")
                                       if ";" in description else [""])
                index += 1
        elif command == 15:  # GET_VARIABLE
            key = C.cast(data, C.POINTER(Variable))[0].key.decode()
            choices = self.variables.get(key)
            if not choices:
                return False
            value = OPTIONS.get(key, choices[0])
            value = {choice.lower(): choice for choice in choices}.get(value.lower(), choices[0])
            buffer = C.create_string_buffer(value.encode())
            self._keep.append(buffer)
            C.cast(data, C.POINTER(C.c_void_p))[1] = C.cast(buffer, C.c_void_p).value
        elif command == 17:  # GET_VARIABLE_UPDATE
            C.cast(data, C.POINTER(C.c_bool))[0] = False
        elif command == 52:  # GET_CORE_OPTIONS_VERSION; use SET_VARIABLES
            C.cast(data, C.POINTER(C.c_uint))[0] = 0
        elif command == 47:  # GET_AUDIO_VIDEO_ENABLE
            C.cast(data, C.POINTER(C.c_int))[0] = 3
        elif command == 39:  # GET_LANGUAGE: English
            C.cast(data, C.POINTER(C.c_uint))[0] = 0
        elif command not in (6, 8, 11, 18, 32, 34, 35, 37, 44, 51, 60, 64, 65):
            return False
        return True

    def _video(self, data, width, height, pitch):
        if not data:
            return
        self.width, self.height = width, height
        bytes_per_pixel = 4 if self.pixel_format == 1 else 2
        raw = C.string_at(data, pitch * height)
        self.pixels = b"".join(raw[row * pitch:row * pitch + width * bytes_per_pixel]
                               for row in range(height))

    def _audio(self, left, right):
        self.audio.extend(struct.pack("<hh", left, right))

    def _audio_batch(self, pointer, frames):
        self.audio.extend(C.string_at(pointer, frames * 4))
        return frames

    def _input(self, port, device, index, identifier):
        if port != 0:
            return 0
        device &= 0xFF
        if device == 1:  # JOYPAD
            if identifier == 256:
                return sum(1 << BUTTONS[button] for button in self.buttons)
            return int(any(BUTTONS[button] == identifier for button in self.buttons))
        if device == 6 and self.touch is not None:  # POINTER; bottom screen
            x, y = self.touch
            if identifier == 0:
                return int(((x + 0.5) / 256) * 65534 - 32767)
            if identifier == 1:
                return int(((192 + y + 0.5) / 384) * 65534 - 32767)
            if identifier in (2, 3):
                return 1
        return 0

    def step(self, frames=1):
        for _ in range(frames):
            self.lib.retro_run()
            self.frame += 1

    def image(self):
        from PIL import Image
        if self.pixels is None:
            raise RuntimeError("libretro core has not produced a video frame")
        if self.pixel_format == 1:
            return Image.frombytes("RGB", (self.width, self.height), self.pixels, "raw", "BGRX")
        rgb = bytearray()
        for (pixel,) in struct.iter_unpack("<H", self.pixels):
            if self.pixel_format == 2:  # RGB565
                rgb.extend((((pixel >> 11) & 31) * 255 // 31,
                            ((pixel >> 5) & 63) * 255 // 63, (pixel & 31) * 255 // 31))
            else:  # 0RGB1555
                rgb.extend((((pixel >> 10) & 31) * 255 // 31,
                            ((pixel >> 5) & 31) * 255 // 31, (pixel & 31) * 255 // 31))
        return Image.frombytes("RGB", (self.width, self.height), bytes(rgb))

    def shot(self, name):
        image = self.image()
        image.save(self.outdir / (name + ".png"))
        return image

    def save_audio(self, name="audio"):
        with wave.open(str(self.outdir / (name + ".wav")), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(round(self.sample_rate))
            output.writeframes(self.audio)

    def close(self):
        if not self._closed:
            self.lib.retro_unload_game()
            self.lib.retro_deinit()
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
