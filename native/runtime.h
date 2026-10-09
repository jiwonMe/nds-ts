#pragma once

#include <stddef.h>
#include <stdint.h>

#include "duktape.h"
#include "graphics.h"

namespace ndsts {

struct TouchState {
    int x = 0, y = 0;
    bool down = false, pressed = false, released = false;
};

// Bits follow the SDK button order, independent of libnds/libretro key masks.
struct InputState {
    uint16_t held = 0, pressed = 0, released = 0;
    TouchState touch;
    uint32_t frame = 0;
};

struct Host {
    Screen& top;
    Screen& bottom;
    uint32_t (*micros)();
    void (*tone)(int frequency, int frames, float volume);
    void (*log)(const char* message);
};

class Runtime {
   public:
    static constexpr size_t heapLimit = 512 * 1024;
    explicit Runtime(Host host) : host_(host) {}
    ~Runtime();
    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;

    bool boot(const unsigned char* script, size_t length);
    bool update(const InputState& state);
    bool draw();
    const char* error() const { return error_; }
    bool healthy() const { return context_ && !error_[0]; }
    size_t heapBytes() const { return heapBytes_; }
    size_t heapPeakBytes() const { return heapPeakBytes_; }
    uint32_t updateMicros() const { return updateMicros_; }
    uint32_t drawMicros() const { return drawMicros_; }

    Host& host() { return host_; }
    const InputState& input() const { return input_; }
    bool timedOut() const;

   private:
    Host host_;
    InputState input_;
    duk_context* context_ = nullptr;
    size_t heapBytes_ = 0, heapPeakBytes_ = 0;
    uint32_t updateMicros_ = 0, drawMicros_ = 0;
    uint32_t callStart_ = 0, callBudget_ = 0;
    bool executing_ = false;
    char error_[512] = {};
    const unsigned char* startupScript_ = nullptr;
    size_t startupLength_ = 0;
    const char* method_ = nullptr;
    bool optionalMethod_ = false;

    void bind();
    void sync();
    bool call(const char* method, bool optional = false);
    void invoke(const char* method, bool optional);
    void captureError(const char* where);
    static duk_ret_t protectedBoot(duk_context* ctx, void* user);
    static duk_ret_t protectedSync(duk_context* ctx, void* user);
    static duk_ret_t protectedCallback(duk_context* ctx, void* user);
    static void* allocate(void* user, duk_size_t size);
    static void* reallocate(void* user, void* pointer, duk_size_t size);
    static void release(void* user, void* pointer);
    static void fatal(void* user, const char* message);
};

}  // namespace ndsts
