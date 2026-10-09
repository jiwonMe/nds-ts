// SPDX-License-Identifier: MIT
#pragma once

#include <cstdint>

namespace ndsts {

// A software screen backed by a contiguous DS bitmap (RGB15, opaque bit 15),
// optionally using DS geometry hardware for the top screen instead.
// Public colors use 0xRRGGBB so games share their palette with the web preview.
class Screen {
public:
    static constexpr int width = 256;
    static constexpr int height = 192;

    explicit Screen(uint16_t* pixels, bool hardwareTop = false) : pixels_(pixels) {
#if defined(__NDS__) && defined(ARM9)
        hardwareTop_ = hardwareTop;
#else
        (void)hardwareTop;
#endif
    }

    void initHardwareTop();
    void beginFrame();
    void endFrame();
    bool overflowed() const { return overflowed_; }

    void clear(uint32_t color);
    void rect(int x, int y, int w, int h, uint32_t color);
    void text(const char* text, int x, int y, uint32_t color);
    void sprite(const char* name, int x, int y);

private:
    uint16_t* pixels_;
    bool hardwareTop_ = false;
    bool overflowed_ = false;
    int quads_ = 0;

    void hardwareQuad(int left, int top, int right, int bottom, uint16_t pixel);
};

} // namespace ndsts
