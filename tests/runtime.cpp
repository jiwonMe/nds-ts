// SPDX-License-Identifier: MIT
#include "runtime.h"

#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

struct Tone {
    int frequency;
    int frames;
    float volume;
};

std::vector<Tone> tones;
std::vector<std::string> logs;

uint32_t micros() {
    return static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::microseconds>(
        Clock::now().time_since_epoch()).count());
}

void tone(int frequency, int frames, float volume) {
    tones.push_back({frequency, frames, volume});
}

void log(const char* message) {
    logs.emplace_back(message ? message : "");
}

void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void near(double actual, double expected, const char* message) {
    require(std::abs(actual - expected) < 0.01,
            std::string(message) + ": expected " + std::to_string(expected) +
            ", got " + std::to_string(actual));
}

struct Fixture {
    std::array<uint16_t, ndsts::Screen::width * ndsts::Screen::height> topPixels{};
    std::array<uint16_t, ndsts::Screen::width * ndsts::Screen::height> bottomPixels{};
    ndsts::Screen top{topPixels.data()};
    ndsts::Screen bottom{bottomPixels.data()};
    ndsts::Runtime runtime{{top, bottom, micros, tone, log}};

    Fixture() {
        tones.clear();
        logs.clear();
    }

    bool boot(const std::string& script) {
        return runtime.boot(reinterpret_cast<const unsigned char*>(script.data()), script.size());
    }
};

struct SpritePosition {
    double x;
    double y;
};

SpritePosition orb(const Fixture& fixture) {
    // Match the original orb's main RGB15 color below the HUD, excluding its
    // outline, shading and highlight. A centroid measures actual native pixels.
    constexpr uint16_t fill = 0xc41a; // 0xD6008F, RGB15 with opaque bit 15.
    int count = 0;
    double x = 0, y = 0;
    for (int row = 40; row < 154; ++row) {
        for (int column = 0; column < ndsts::Screen::width; ++column) {
            if (fixture.topPixels[row * ndsts::Screen::width + column] == fill) {
                ++count;
                x += column;
                y += row;
            }
        }
    }
    require(count >= 70, "native framebuffer must contain the rendered orb");
    return {x / count, y / count};
}

void healthy(const Fixture& fixture, const char* operation) {
    require(fixture.runtime.healthy(), std::string(operation) + ": " + fixture.runtime.error());
    require(fixture.runtime.heapBytes() > 0, "live JS heap must report allocations");
    require(fixture.runtime.heapBytes() <= ndsts::Runtime::heapLimit, "live heap exceeded its cap");
    require(fixture.runtime.heapPeakBytes() >= fixture.runtime.heapBytes(), "heap peak fell below live heap");
    require(fixture.runtime.heapPeakBytes() <= ndsts::Runtime::heapLimit, "peak heap exceeded its cap");
}

void stopped(Fixture& fixture, const char* detail) {
    require(!fixture.runtime.healthy(), "failed game must become unhealthy");
    require(std::strstr(fixture.runtime.error(), detail) != nullptr,
            std::string("expected error containing '") + detail + "', got " + fixture.runtime.error());
    require(!logs.empty(), "runtime failure must reach the host error log");
    require(!fixture.runtime.update({}), "failed game must reject further updates");
    require(!fixture.runtime.draw(), "failed game must reject further draws");
    require(fixture.runtime.heapPeakBytes() <= ndsts::Runtime::heapLimit, "failed heap exceeded cap");
}

void demo(const std::string& script) {
    Fixture fixture;
    require(fixture.boot(script), std::string("demo boot failed: ") + fixture.runtime.error());
    require(fixture.runtime.draw(), "demo's first draw failed");
    healthy(fixture, "demo boot/draw");
    const SpritePosition initial = orb(fixture);

    ndsts::InputState input;
    input.frame = 1;
    input.held = 1u << 3; // right
    input.pressed = input.held;
    require(fixture.runtime.update(input) && fixture.runtime.draw(), "right input failed");
    const SpritePosition moved = orb(fixture);
    near(moved.x - initial.x, 2, "D-pad must move the rendered orb two pixels");
    near(moved.y, initial.y, "horizontal movement must preserve grounded height");

    input = {};
    input.frame = 2;
    input.held = 1u << 4; // A
    input.pressed = input.held;
    require(fixture.runtime.update(input) && fixture.runtime.draw(), "A input failed");
    require(tones.size() == 1, "A must call the native audio host once");
    require(tones[0].frequency == 660 && tones[0].frames == 7, "A emitted the wrong tone");
    near(tones[0].volume, 0.22, "A tone volume");
    require(orb(fixture).y < moved.y, "A must raise the orb's native pixels");

    input = {};
    input.frame = 3;
    input.touch = {200, 82, true, true, false};
    require(fixture.runtime.update(input) && fixture.runtime.draw(), "touch input failed");
    const SpritePosition teleported = orb(fixture);
    near(teleported.x - initial.x, 72, "touch must teleport the orb horizontally");
    near(teleported.y - initial.y, -64, "touch must teleport the orb vertically");
    require(tones.size() == 2 && tones[1].frequency == 880, "touch must emit its native tone");
    require(fixture.bottomPixels[82 * ndsts::Screen::width + 200] == 0xc41a,
            "lower screen must draw the magenta touch crosshair");

    input = {};
    input.frame = 4;
    input.held = 1u << 5; // B
    input.pressed = input.held;
    require(fixture.runtime.update(input) && fixture.runtime.draw(), "B input failed");
    require(tones.size() == 3 && tones[2].frequency == 550, "B must cycle the accent and tone");
    require(fixture.topPixels[32 * ndsts::Screen::width + 12] == 0xeae0,
            "B must change the top screen's accent to cyan");
    healthy(fixture, "demo inputs");
    std::printf("PASS compiled TypeScript demo: native pixels, buttons, touch, audio, heap stats\n");
}

void callbacks() {
    {
        Fixture fixture;
        require(fixture.boot("var game={update:function(){throw new Error('update exploded')},draw:function(){}};"),
                "throwing-update script should boot");
        require(!fixture.runtime.update({}), "throwing update must fail safely");
        stopped(fixture, "update exploded");
    }
    {
        Fixture fixture;
        require(fixture.boot("var game={update:function(){},draw:function(){throw new Error('draw exploded')}};"),
                "throwing-draw script should boot");
        require(!fixture.runtime.draw(), "throwing draw must fail safely");
        stopped(fixture, "draw exploded");
    }
    {
        Fixture fixture;
        require(!fixture.boot("var game={init:function(){throw new Error('init exploded')},update:function(){},draw:function(){}};"),
                "throwing init must fail safely");
        stopped(fixture, "init exploded");
    }
    std::printf("PASS callback exceptions stop the game and report host errors\n");
}

void hostileProperties() {
    {
        Fixture fixture;
        require(!fixture.boot("var game={draw:function(){}};Object.defineProperty(game,'update',{get:function(){throw new Error('boot getter')}});"),
                "throwing boot-time callback getter must fail safely");
        stopped(fixture, "boot getter");
    }
    {
        Fixture fixture;
        require(fixture.boot("var game={init:function(){Object.defineProperty(this,'update',{get:function(){throw new Error('callback getter')}})},update:function(){},draw:function(){}};"),
                "callback-mutating init should boot");
        require(!fixture.runtime.update({}), "throwing callback getter must fail safely");
        stopped(fixture, "callback getter");
    }
    {
        Fixture fixture;
        require(fixture.boot("var game={init:function(){nds.touch=null},update:function(){},draw:function(){}};"),
                "SDK-mutating init should boot");
        require(!fixture.runtime.update({}), "corrupt touch SDK object must fail safely");
        stopped(fixture, "TypeError");
    }
    std::printf("PASS property getters and corrupted SDK state stay inside protected calls\n");
}

void watchdog() {
    {
        Fixture fixture;
        require(fixture.boot("var game={update:function(){while(true){}},draw:function(){}};"),
                "looping-update script should boot");
        const auto started = Clock::now();
        require(!fixture.runtime.update({}), "infinite update must time out");
        require(Clock::now() - started < std::chrono::seconds(3), "update watchdog took longer than three seconds");
        stopped(fixture, "execution timeout");
    }
    {
        Fixture fixture;
        const auto started = Clock::now();
        require(!fixture.boot("while(true){}"), "infinite bootstrap must time out");
        require(Clock::now() - started < std::chrono::seconds(3), "boot watchdog took longer than three seconds");
        stopped(fixture, "execution timeout");
    }
    std::printf("PASS bounded watchdog interrupts infinite update and bootstrap scripts\n");
}

void heapLimit() {
    Fixture fixture;
    require(fixture.boot("var buffers=[];var game={update:function(){for(var i=0;i<32;i++){buffers.push(new Uint8Array(65536))}},draw:function(){}};"),
            "heap-limit script should boot");
    require(!fixture.runtime.update({}), "retained buffers must hit the 512 KiB heap cap");
    stopped(fixture, "alloc");
    require(fixture.runtime.heapPeakBytes() >= 384 * 1024, "allocation test must actually approach the heap cap");
    std::printf("PASS heap exhaustion is caught at %zu peak bytes (cap %zu)\n",
                fixture.runtime.heapPeakBytes(), ndsts::Runtime::heapLimit);
}

} // namespace

int main(int argc, char** argv) {
    try {
        require(argc == 2, "usage: runtime-test <compiled game.js>");
        std::ifstream file(argv[1], std::ios::binary);
        require(file.good(), "cannot read the actual compiled game.js");
        const std::string script{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
        require(!script.empty(), "compiled game.js is empty");
        demo(script);
        callbacks();
        hostileProperties();
        watchdog();
        heapLimit();
        std::printf("All native runtime integration checks passed.\n");
        return 0;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "FAIL native runtime: %s\n", error.what());
        return 1;
    }
}
