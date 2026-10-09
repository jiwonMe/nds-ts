// SPDX-License-Identifier: MIT
#include "graphics.h"

#include "font_gen.h"

#include <algorithm>
#include <cstring>

#if defined(__NDS__) && defined(ARM9)
#include <nds.h>
#include <nds/arm9/cache.h>
#include <nds/arm9/cp15.h>
#include <nds/dma.h>
#endif

namespace ndsts {
namespace {

uint16_t rgb15(uint32_t color) {
    const uint16_t red = static_cast<uint16_t>((color >> 19) & 31);
    const uint16_t green = static_cast<uint16_t>((color >> 11) & 31);
    const uint16_t blue = static_cast<uint16_t>((color >> 3) & 31);
    return static_cast<uint16_t>(0x8000 | red | (green << 5) | (blue << 10));
}

uint16_t glyphBits(unsigned char character) {
    if (character >= 'a' && character <= 'z') {
        character = static_cast<unsigned char>(character - 'a' + 'A');
    }
    // The shared generator emits contiguous ASCII glyphs starting at space.
    const unsigned int index = static_cast<unsigned int>(character) - 32;
    if (index >= FONT_GLYPH_COUNT ||
        static_cast<unsigned char>(FONT_GLYPHS[index].character) != character) return 0;
    return FONT_GLYPHS[index].bits;
}

void fillPixels(uint16_t* pixels, size_t count, uint16_t pixel) {
#if defined(__NDS__) && defined(ARM9)
    const uintptr_t address = reinterpret_cast<uintptr_t>(pixels);
    // DMA cannot access TCM. Only accelerate the DS's ordinary 4 MiB main RAM.
    if (count >= 64 && address >= 0x02000000 && address + count * 2 <= 0x02400000) {
        // Keep shared boundary cache lines on the CPU. Invalidate only complete
        // lines whose old contents are entirely replaced, preserving neighbors.
        const size_t leading = std::min(count, ((32 - (address & 31)) & 31) / 2);
        std::fill(pixels, pixels + leading, pixel);
        pixels += leading;
        count -= leading;
        const size_t middle = count & ~static_cast<size_t>(15);
        if (middle >= 64) {
            DC_InvalidateRange(pixels, static_cast<uint32_t>(middle * 2));
            CP15_DrainWriteBuffer();
            const uint32_t pair = pixel | (static_cast<uint32_t>(pixel) << 16);
            // libnds uses channel 3's hardware fill register and waits for the
            // transfer; frame presentation uses channel 0 after drawing ends.
            dmaFillWords(pair, pixels, static_cast<uint32_t>(middle * 2));
            pixels += middle;
            count -= middle;
        }
    }
#endif
    std::fill(pixels, pixels + count, pixel);
}

uint16_t orbPixel(int column, int row) {
    const int dx = 2 * column - 15;
    const int dy = 2 * row - 15;
    const int distance = dx * dx + dy * dy;
    if (distance > 225) return 0;

    const uint16_t outline = rgb15(0x202020);
    uint16_t pixel = distance > 169 ? outline : rgb15(0xd6008f);
    if (distance <= 169 && row >= 11) pixel = rgb15(0xa80070);
    if (distance <= 169 && column >= 3 && column <= 6 && row >= 3 && row <= 5) {
        pixel = rgb15(0xffc2e9);
    }
    if ((column == 5 || column == 10) && (row == 7 || row == 8)) pixel = outline;
    return pixel;
}

} // namespace

void Screen::initHardwareTop() {
#if defined(__NDS__) && defined(ARM9)
    if (!hardwareTop_) return;
    glInit();
    glEnable(GL_BLEND);
    glDisable(GL_TEXTURE_2D | GL_ANTIALIAS | GL_OUTLINE | GL_FOG);
    glClearColor(0, 0, 0, 31);
    glClearPolyID(63);
    glClearDepth(GL_MAX_DEPTH);
    glViewport(0, 0, width - 1, height - 1);
    REG_BG0CNT = BG_PRIORITY(0);
#endif
}

void Screen::beginFrame() {
    quads_ = 0;
    overflowed_ = false;
#if defined(__NDS__) && defined(ARM9)
    if (!hardwareTop_) return;
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    // Raw vertex coordinates use the same units as this projection, avoiding
    // conversions for each integer pixel in the native SDK.
    glOrthof32(0, width, height, 0, -4096, 4096);
    glMatrixMode(GL_MODELVIEW);
    glLoadIdentity();
#endif
}

void Screen::endFrame() {
#if defined(__NDS__) && defined(ARM9)
    if (hardwareTop_) glFlush(GL_TRANS_MANUALSORT);
#endif
}

void Screen::hardwareQuad(int left, int top, int right, int bottom, uint16_t pixel) {
    if (quads_ >= 1500) {
        overflowed_ = true;
        return;
    }
    ++quads_;
#if defined(__NDS__) && defined(ARM9)
    const uint16_t depth = static_cast<uint16_t>(-4000 + quads_);
    GFX_POLY_FORMAT = POLY_ALPHA(31) | POLY_CULL_NONE | POLY_ID(0);
    GFX_TEX_FORMAT = 0;
    GFX_COLOR = pixel & 0x7fff;
    GFX_BEGIN = GL_QUADS;
    GFX_VERTEX16 = (static_cast<uint32_t>(top) << 16) | static_cast<uint32_t>(left);
    GFX_VERTEX16 = depth;
    GFX_VERTEX16 = (static_cast<uint32_t>(bottom) << 16) | static_cast<uint32_t>(left);
    GFX_VERTEX16 = depth;
    GFX_VERTEX16 = (static_cast<uint32_t>(bottom) << 16) | static_cast<uint32_t>(right);
    GFX_VERTEX16 = depth;
    GFX_VERTEX16 = (static_cast<uint32_t>(top) << 16) | static_cast<uint32_t>(right);
    GFX_VERTEX16 = depth;
    GFX_END = 0;
#else
    (void)left;
    (void)top;
    (void)right;
    (void)bottom;
    (void)pixel;
#endif
}

void Screen::clear(uint32_t color) {
    if (hardwareTop_) {
        hardwareQuad(0, 0, width, height, rgb15(color));
        return;
    }
    fillPixels(pixels_, width * height, rgb15(color));
}

void Screen::rect(int x, int y, int w, int h, uint32_t color) {
    if (w <= 0 || h <= 0) return;

    const int64_t left = std::max<int64_t>(0, x);
    const int64_t top = std::max<int64_t>(0, y);
    const int64_t right = std::min<int64_t>(width, static_cast<int64_t>(x) + w);
    const int64_t bottom = std::min<int64_t>(height, static_cast<int64_t>(y) + h);
    if (left >= right || top >= bottom) return;

    const uint16_t pixel = rgb15(color);
    if (hardwareTop_) {
        hardwareQuad(static_cast<int>(left), static_cast<int>(top),
                     static_cast<int>(right), static_cast<int>(bottom), pixel);
        return;
    }
    if (left == 0 && right == width) {
        fillPixels(pixels_ + static_cast<int>(top) * width,
                   static_cast<size_t>((bottom - top) * width), pixel);
        return;
    }
    for (int row = static_cast<int>(top); row < bottom; ++row) {
        uint16_t* start = pixels_ + row * width + static_cast<int>(left);
        fillPixels(start, static_cast<size_t>(right - left), pixel);
    }
}

void Screen::text(const char* text, int x, int y, uint32_t color) {
    if (text == nullptr) return;

    const uint16_t pixel = rgb15(color);
    int64_t cursorX = x;
    int64_t cursorY = y;
    for (const unsigned char* current = reinterpret_cast<const unsigned char*>(text);
         *current != 0; ++current) {
        if (*current == '\n') {
            cursorX = x;
            cursorY += 7;
            continue;
        }

        const uint16_t bits = glyphBits(*current);
        if (bits && cursorX > -3 && cursorX < width && cursorY > -5 && cursorY < height) {
            const int glyphX = static_cast<int>(cursorX), glyphY = static_cast<int>(cursorY);
            const int firstColumn = std::max(0, -glyphX);
            const int lastColumn = std::min(3, width - glyphX);
            const int firstRow = std::max(0, -glyphY);
            const int lastRow = std::min(5, height - glyphY);
            for (int row = firstRow; row < lastRow; ++row) {
                const unsigned int rowBits = bits >> (row * 3);
                if (hardwareTop_) {
                    for (int column = firstColumn; column < lastColumn; ++column) {
                        if ((rowBits & (1u << column)) != 0) {
                            hardwareQuad(glyphX + column, glyphY + row,
                                         glyphX + column + 1, glyphY + row + 1, pixel);
                        }
                    }
                    continue;
                }
                uint16_t* destination = pixels_ + (glyphY + row) * width + glyphX + firstColumn;
                for (int column = firstColumn; column < lastColumn; ++column, ++destination) {
                    if ((rowBits & (1u << column)) != 0) *destination = pixel;
                }
            }
        }
        cursorX += 4;
    }
}

void Screen::sprite(const char* name, int x, int y) {
    if (name == nullptr || std::strcmp(name, "orb") != 0) return;
    if (x <= -16 || x >= width || y <= -16 || y >= height) return;

    const int firstColumn = std::max(0, -x);
    const int lastColumn = std::min(16, width - x);
    const int firstRow = std::max(0, -y);
    const int lastRow = std::min(16, height - y);

    for (int row = firstRow; row < lastRow; ++row) {
        if (hardwareTop_) {
            // Adjacent opaque pixels with one color form a single quad. This
            // keeps the original raster sprite without consuming 256 polygons.
            int column = firstColumn;
            while (column < lastColumn) {
                const uint16_t pixel = orbPixel(column, row);
                const int first = column++;
                while (column < lastColumn && orbPixel(column, row) == pixel) ++column;
                if (pixel) hardwareQuad(x + first, y + row, x + column, y + row + 1, pixel);
            }
            continue;
        }
        uint16_t* destination = pixels_ + (y + row) * width + x + firstColumn;
        for (int column = firstColumn; column < lastColumn; ++column, ++destination) {
            const uint16_t pixel = orbPixel(column, row);
            if (pixel) *destination = pixel;
        }
    }
}

} // namespace ndsts
