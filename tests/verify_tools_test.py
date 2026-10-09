"""Standard-library checks for the measurements used by verify-rom.py."""
import importlib.util
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("verify_rom", Path(__file__).resolve().parents[1] / "tools" / "verify-rom.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class FakeImage:
    size = (256, 384)

    def __init__(self, extra=False):
        self.extra = extra

    def load(self):
        return self

    def __getitem__(self, position):
        x, y = position
        # Header/floor accents must not contaminate the orb measurement.
        magenta = (y in (32, 154)) or (120 <= x < 132 and 138 <= y < 150)
        magenta |= self.extra and 40 <= x < 52 and 70 <= y < 82
        return (214, 0, 140) if magenta else (255, 255, 255)


class VerificationToolsTest(unittest.TestCase):
    def test_settled_motion_and_frame_rate_are_independent_checks(self):
        baseline = verify.movement_measurement(60, 33, 2)
        variant = verify.movement_measurement(90, 33, 3)
        self.assertTrue(baseline["correct_motion"] and baseline["full_rate"])
        self.assertTrue(variant["correct_motion"] and variant["full_rate"])
        # Capturing before the GPU has presented the final movement must fail;
        # a tolerance that simply grows with speed would hide this discrepancy.
        self.assertFalse(verify.movement_measurement(87, 33, 3)["correct_motion"])
        # Correct distance cannot conceal a runtime that updates at 30 Hz.
        slow = verify.movement_measurement(90, 17, 3)
        self.assertTrue(slow["correct_motion"])
        self.assertFalse(slow["full_rate"])

    def test_valid_header_and_corruption(self):
        data = bytearray(0x800)
        data[:12] = b"NDS TS DEMO\0"
        struct.pack_into("<I", data, 0x20, 0x200)
        struct.pack_into("<I", data, 0x2C, 0x200)
        struct.pack_into("<I", data, 0x30, 0x400)
        struct.pack_into("<I", data, 0x3C, 0x200)
        struct.pack_into("<H", data, 0x15E, verify.crc16(data[:0x15E]))
        with tempfile.TemporaryDirectory() as directory:
            rom = Path(directory) / "test.nds"
            rom.write_bytes(data)
            report = verify.verify_header(rom)
            self.assertEqual(report["arm9_bytes"], 512)
            data[0] ^= 1
            rom.write_bytes(data)
            with self.assertRaisesRegex(AssertionError, "CRC16"):
                verify.verify_header(rom)
            rom.write_bytes(data[:0x500])
            with self.assertRaisesRegex(AssertionError, "ARM7 binary range"):
                verify.verify_header(rom)

    def test_centroid_ignores_stripes_and_rejects_multiple_objects(self):
        position = verify.orb_position(FakeImage())
        self.assertEqual(position["x"], 125.5)
        self.assertEqual(position["y"], 143.5)
        with self.assertRaisesRegex(AssertionError, "one 16x16 orb"):
            verify.orb_position(FakeImage(extra=True))

    def test_audio_statistics_detect_non_silent_samples(self):
        self.assertEqual(verify.audio_stats(struct.pack("<hhhh", 0, 200, -200, 0)),
                         {"samples": 4, "nonzero_samples": 2, "peak": 200, "rms": 141.421})
        with self.assertRaisesRegex(AssertionError, "no audio samples"):
            verify.audio_stats(b"")
        pcm = b"".join(struct.pack("<hh", *(2 * [round(2000 * math.sin(2 * math.pi * 660 * index / 32768))]))
                       for index in range(8192))
        self.assertLess(abs(verify.tone_frequency(pcm, 32768) - 660), 3)


if __name__ == "__main__":
    unittest.main()
