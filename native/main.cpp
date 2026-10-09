#include <nds.h>
#include <stdio.h>
#include <string.h>

#include "runtime.h"
#include "script_gen.h"

using namespace ndsts;

static uint16_t bottomPixels[256 * 192] __attribute__((aligned(32)));
static uint32_t toneEndFrame = 0, frame = 0;
static bool tonePlaying = false;

static uint32_t micros() {
    uint16_t high = TIMER_DATA(3), low = TIMER_DATA(2);
    if (TIMER_DATA(3) != high) { high = TIMER_DATA(3); low = TIMER_DATA(2); }
    uint32_t ticks = (static_cast<uint32_t>(high) << 16) | low;
    return static_cast<uint32_t>((static_cast<uint64_t>(ticks) * 64000000u) / 33513982u);
}

static void tone(int frequency, int frames, float volume) {
    soundPlayPSGChannel(8, DutyCycle_50, frequency * 8, static_cast<int>(volume * 127), 64);
    tonePlaying = true;
    toneEndFrame = frame + static_cast<uint32_t>(frames);
}

static void log(const char* message) { fprintf(stderr, "[nds-ts] %s\n", message); }

static InputState readInput(uint16_t previous, bool previousTouch) {
    scanKeys();
    uint32_t keys = keysHeld();
    const uint32_t mappings[] = {KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_A, KEY_B, KEY_X, KEY_Y,
                                 KEY_L, KEY_R, KEY_START, KEY_SELECT};
    InputState state;
    state.frame = frame;
    for (int i = 0; i < 12; i++) if (keys & mappings[i]) state.held |= 1u << i;
    state.pressed = state.held & ~previous;
    state.released = previous & ~state.held;
    state.touch.down = (keys & KEY_TOUCH) != 0;
    state.touch.pressed = state.touch.down && !previousTouch;
    state.touch.released = !state.touch.down && previousTouch;
    static int lastX = 0, lastY = 0;
    if (state.touch.down) {
        touchPosition position;
        touchRead(&position);
        lastX = position.px > 255 ? 255 : position.px;
        lastY = position.py > 191 ? 191 : position.py;
    }
    state.touch.x = lastX;
    state.touch.y = lastY;
    return state;
}

static void errorScreen(Screen& top, Screen& bottom, const char* error) {
    top.clear(0x291c32);
    top.text("NDS-TS SCRIPT ERROR", 12, 12, 0xff718c);
    top.text("FIX YOUR TYPESCRIPT AND REBUILD", 12, 24, 0xffffff);
    // Wrap the diagnostic without allocating or letting a long stack trace run off-screen.
    int x = 12, y = 42;
    int characters = 0;
    for (const char* p = error; *p && y < 180 && characters < 100; p++, characters++) {
        if (*p == '\n' || x > 240) { x = 12; y += 8; }
        if (*p != '\n') { char letter[] = {*p, 0}; top.text(letter, x, y, 0xffffff); x += 4; }
    }
    bottom.clear(0x181c2b);
    bottom.text("THE GAME HAS STOPPED SAFELY", 12, 16, 0xffffff);
    bottom.text("FULL DIAGNOSTIC: EMULATOR DEBUG LOG", 12, 28, 0x91a4bc);
}

int main() {
    defaultExceptionHandler();
    consoleDebugInit(DebugDevice_NOCASH);
    lcdMainOnTop();
    videoSetMode(MODE_0_3D);
    videoSetModeSub(MODE_5_2D);
    vramSetBankC(VRAM_C_SUB_BG);
    int bottomBg = bgInitSub(3, BgType_Bmp16, BgSize_B16_256x256, 0, 0);
    TIMER_DATA(2) = TIMER_DATA(3) = 0;
    TIMER_CR(3) = TIMER_ENABLE | TIMER_CASCADE;
    TIMER_CR(2) = TIMER_ENABLE | TIMER_DIV_64;
    soundEnable();
    Screen top(nullptr, true), bottom(bottomPixels);
    top.initHardwareTop();
    top.beginFrame();
    Runtime runtime({top, bottom, micros, tone, log});
    runtime.boot(GAME_SCRIPT, GAME_SCRIPT_LENGTH);
    uint16_t previousKeys = 0;
    bool previousTouch = false;
    uint32_t maxUpdate = 0, maxDraw = 0;
    for (;;) {
        top.beginFrame();
        InputState state = readInput(previousKeys, previousTouch);
        previousKeys = state.held;
        previousTouch = state.touch.down;
        if (tonePlaying && frame >= toneEndFrame) { soundKill(8); tonePlaying = false; }
        if (runtime.healthy()) {
            runtime.update(state);
            runtime.draw();
            if (runtime.updateMicros() > maxUpdate) maxUpdate = runtime.updateMicros();
            if (runtime.drawMicros() > maxDraw) maxDraw = runtime.drawMicros();
        }
        if (!runtime.healthy() && !top.overflowed()) {
            soundKill(8);
            errorScreen(top, bottom, runtime.error());
        }
        top.endFrame();
        if (frame % 120 == 0) {
            fprintf(stderr, "[nds-ts] frame=%lu heap=%u peak=%u update_us=%lu draw_us=%lu max_update_us=%lu max_draw_us=%lu\n",
                    static_cast<unsigned long>(frame), static_cast<unsigned>(runtime.heapBytes()),
                    static_cast<unsigned>(runtime.heapPeakBytes()), static_cast<unsigned long>(runtime.updateMicros()),
                    static_cast<unsigned long>(runtime.drawMicros()), static_cast<unsigned long>(maxUpdate),
                    static_cast<unsigned long>(maxDraw));
        }
        // Top is drawn by the geometry engine. Present only the bottom bitmap.
        swiWaitForVBlank();
        // The ARM9 data cache is much smaller than two framebuffers. Flush its
        // dirty lines once, rather than scanning every 32-byte buffer address.
        DC_FlushAll();
        dmaCopyWords(0, bottomPixels, bgGetGfxPtr(bottomBg), sizeof(bottomPixels));
        frame++;
    }
}
