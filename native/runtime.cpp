#include "runtime.h"

#include <math.h>
#include <initializer_list>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace ndsts {
namespace {
struct alignas(8) Allocation {
    size_t bytes;
};

Runtime& runtime(duk_context* ctx) {
    duk_memory_functions memory;
    duk_get_memory_functions(ctx, &memory);
    return *static_cast<Runtime*>(memory.udata);
}

int coordinate(duk_context* ctx, int argument) {
    double value = duk_require_number(ctx, argument);
    if (!isfinite(value) || value < -32768 || value > 32767)
        return duk_error(ctx, DUK_ERR_RANGE_ERROR, "coordinate must be finite and within -32768..32767");
    return static_cast<int>(floor(value + 0.5));
}

uint32_t color(duk_context* ctx, int argument) {
    double value = duk_require_number(ctx, argument);
    if (!isfinite(value) || value < 0 || value > 0xffffff || floor(value) != value) {
        duk_error(ctx, DUK_ERR_RANGE_ERROR, "color must be an integer 0x000000..0xffffff");
        return 0;
    }
    return static_cast<uint32_t>(value);
}

Screen& screen(duk_context* ctx) {
    return duk_get_current_magic(ctx) ? runtime(ctx).host().bottom : runtime(ctx).host().top;
}

duk_ret_t clear(duk_context* ctx) {
    screen(ctx).clear(color(ctx, 0));
    return 0;
}

duk_ret_t rect(duk_context* ctx) {
    int x = coordinate(ctx, 0), y = coordinate(ctx, 1);
    int width = coordinate(ctx, 2), height = coordinate(ctx, 3);
    screen(ctx).rect(x, y, width, height, color(ctx, 4));
    return 0;
}

duk_ret_t text(duk_context* ctx) {
    duk_size_t length;
    const char* value = duk_require_lstring(ctx, 0, &length);
    if (length > 1024) return duk_error(ctx, DUK_ERR_RANGE_ERROR, "text is limited to 1024 bytes per call");
    for (duk_size_t i = 0; i < length; i++) {
        unsigned char character = static_cast<unsigned char>(value[i]);
        if ((character < 32 || character > 126) && character != '\n')
            return duk_error(ctx, DUK_ERR_RANGE_ERROR, "text supports printable ASCII and newline in v0.1");
    }
    int x = coordinate(ctx, 1), y = coordinate(ctx, 2);
    screen(ctx).text(value, x, y, color(ctx, 3));
    return 0;
}

duk_ret_t sprite(duk_context* ctx) {
    const char* name = duk_require_string(ctx, 0);
    if (strcmp(name, "orb")) return duk_error(ctx, DUK_ERR_RANGE_ERROR, "unknown sprite: %s", name);
    screen(ctx).sprite(name, coordinate(ctx, 1), coordinate(ctx, 2));
    return 0;
}

const char* const buttons[] = {"up", "down", "left", "right", "a", "b", "x", "y", "l", "r", "start", "select"};

duk_ret_t button(duk_context* ctx) {
    const char* name = duk_require_string(ctx, 0);
    int index = -1;
    for (int i = 0; i < 12; i++) {
        if (!strcmp(name, buttons[i])) { index = i; break; }
    }
    if (index < 0) return duk_error(ctx, DUK_ERR_RANGE_ERROR, "unknown button: %s", name);
    const InputState& state = runtime(ctx).input();
    int mode = duk_get_current_magic(ctx);
    uint16_t mask = mode == 0 ? state.held : mode == 1 ? state.pressed : state.released;
    duk_push_boolean(ctx, (mask & (1u << index)) != 0);
    return 1;
}

duk_ret_t direction(duk_context* ctx) {
    uint16_t held = runtime(ctx).input().held;
    int negative = duk_get_current_magic(ctx) ? 0 : 2;
    int positive = duk_get_current_magic(ctx) ? 1 : 3;
    duk_push_int(ctx, ((held >> positive) & 1) - ((held >> negative) & 1));
    return 1;
}

duk_ret_t tone(duk_context* ctx) {
    double frequency = duk_require_number(ctx, 0), frames = duk_require_number(ctx, 1);
    double volume = duk_is_undefined(ctx, 2) ? 0.3 : duk_require_number(ctx, 2);
    if (!isfinite(frequency) || frequency < 40 || frequency > 4000 || !isfinite(frames) ||
        frames < 1 || frames > 600 || floor(frames) != frames || !isfinite(volume) || volume < 0 || volume > 1)
        return duk_error(ctx, DUK_ERR_RANGE_ERROR, "tone needs frequency 40..4000, frames 1..600, volume 0..1");
    runtime(ctx).host().tone(static_cast<int>(frequency), static_cast<int>(frames), static_cast<float>(volume));
    return 0;
}

duk_ret_t log(duk_context* ctx) {
    char message[256] = {};
    size_t written = 0;
    for (int i = 0; i < duk_get_top(ctx) && written < sizeof(message) - 1; i++) {
        const char* value = duk_safe_to_string(ctx, i);
        int count = snprintf(message + written, sizeof(message) - written, "%s%s", i ? " " : "", value);
        if (count < 0) break;
        size_t remaining = sizeof(message) - written - 1;
        written += static_cast<size_t>(count) < remaining ? static_cast<size_t>(count) : remaining;
    }
    runtime(ctx).host().log(message);
    return 0;
}

void numberProperty(duk_context* ctx, const char* name, double value) {
    duk_push_number(ctx, value);
    duk_put_prop_string(ctx, -2, name);
}

void boolProperty(duk_context* ctx, const char* name, bool value) {
    duk_push_boolean(ctx, value);
    duk_put_prop_string(ctx, -2, name);
}

void functionProperty(duk_context* ctx, const char* name, duk_c_function function, int args, int magic = 0) {
    duk_push_c_function(ctx, function, args);
    duk_set_magic(ctx, -1, magic);
    duk_put_prop_string(ctx, -2, name);
}
}  // namespace

void* Runtime::allocate(void* user, duk_size_t size) {
    Runtime& self = *static_cast<Runtime*>(user);
    if (!size || size > heapLimit - sizeof(Allocation) || self.heapBytes_ > heapLimit - size - sizeof(Allocation)) return nullptr;
    Allocation* allocation = static_cast<Allocation*>(malloc(size + sizeof(Allocation)));
    if (!allocation) return nullptr;
    allocation->bytes = size;
    self.heapBytes_ += size + sizeof(Allocation);
    if (self.heapBytes_ > self.heapPeakBytes_) self.heapPeakBytes_ = self.heapBytes_;
    return allocation + 1;
}

void Runtime::release(void* user, void* pointer) {
    if (!pointer) return;
    Runtime& self = *static_cast<Runtime*>(user);
    Allocation* allocation = static_cast<Allocation*>(pointer) - 1;
    self.heapBytes_ -= allocation->bytes + sizeof(Allocation);
    free(allocation);
}

void* Runtime::reallocate(void* user, void* pointer, duk_size_t size) {
    if (!pointer) return allocate(user, size);
    if (!size) { release(user, pointer); return nullptr; }
    Runtime& self = *static_cast<Runtime*>(user);
    Allocation* previous = static_cast<Allocation*>(pointer) - 1;
    size_t oldSize = previous->bytes;
    size_t otherBytes = self.heapBytes_ - oldSize - sizeof(Allocation);
    if (size > heapLimit - sizeof(Allocation) || otherBytes > heapLimit - size - sizeof(Allocation)) return nullptr;
    Allocation* allocation = static_cast<Allocation*>(realloc(previous, size + sizeof(Allocation)));
    if (!allocation) return nullptr;
    allocation->bytes = size;
    self.heapBytes_ = otherBytes + size + sizeof(Allocation);
    if (self.heapBytes_ > self.heapPeakBytes_) self.heapPeakBytes_ = self.heapBytes_;
    return allocation + 1;
}

void Runtime::fatal(void* user, const char* message) {
    Runtime& self = *static_cast<Runtime*>(user);
    self.host_.log(message ? message : "Duktape fatal error");
    // A fatal Duktape error cannot return. The DS exception handler reports it.
    abort();
}

Runtime::~Runtime() {
    if (context_) duk_destroy_heap(context_);
}

bool Runtime::timedOut() const {
    return executing_ && host_.micros() - callStart_ > callBudget_;
}

void Runtime::bind() {
    duk_context* ctx = context_;
    duk_push_object(ctx);
    numberProperty(ctx, "width", Screen::width);
    numberProperty(ctx, "height", Screen::height);
    numberProperty(ctx, "frame", 0);
    for (int which = 0; which < 2; which++) {
        duk_push_object(ctx);
        functionProperty(ctx, "clear", clear, 1, which);
        functionProperty(ctx, "rect", rect, 5, which);
        functionProperty(ctx, "text", text, 4, which);
        functionProperty(ctx, "sprite", sprite, 3, which);
        duk_put_prop_string(ctx, -2, which ? "bottom" : "top");
    }
    duk_push_object(ctx);
    functionProperty(ctx, "down", button, 1, 0);
    functionProperty(ctx, "hit", button, 1, 1);
    functionProperty(ctx, "up", button, 1, 2);
    functionProperty(ctx, "dx", direction, 0, 0);
    functionProperty(ctx, "dy", direction, 0, 1);
    duk_put_prop_string(ctx, -2, "input");
    duk_push_object(ctx);
    duk_put_prop_string(ctx, -2, "touch");
    duk_push_object(ctx);
    duk_put_prop_string(ctx, -2, "stats");
    duk_push_object(ctx);
    functionProperty(ctx, "tone", tone, 3);
    duk_put_prop_string(ctx, -2, "audio");
    // Keep the actual native objects rooted even if a script changes globals.
    duk_push_heap_stash(ctx);
    duk_dup(ctx, -2);
    duk_put_prop_string(ctx, -2, "nds");
    duk_pop(ctx);
    duk_put_global_string(ctx, "nds");
    duk_push_object(ctx);
    functionProperty(ctx, "log", log, DUK_VARARGS);
    duk_put_global_string(ctx, "console");
}

void Runtime::sync() {
    duk_context* ctx = context_;
    duk_push_heap_stash(ctx);
    duk_get_prop_string(ctx, -1, "nds");
    numberProperty(ctx, "frame", input_.frame);
    duk_get_prop_string(ctx, -1, "touch");
    numberProperty(ctx, "x", input_.touch.x);
    numberProperty(ctx, "y", input_.touch.y);
    boolProperty(ctx, "down", input_.touch.down);
    boolProperty(ctx, "pressed", input_.touch.pressed);
    boolProperty(ctx, "released", input_.touch.released);
    duk_pop(ctx);
    duk_get_prop_string(ctx, -1, "stats");
    numberProperty(ctx, "heapBytes", heapBytes_);
    numberProperty(ctx, "heapPeakBytes", heapPeakBytes_);
    numberProperty(ctx, "updateMicros", updateMicros_);
    numberProperty(ctx, "drawMicros", drawMicros_);
    duk_pop_3(ctx);
}

void Runtime::captureError(const char* where) {
    const char* detail = duk_safe_to_stacktrace(context_, -1);
    snprintf(error_, sizeof(error_), "%s: %s", where, detail);
    host_.log(error_);
    duk_pop(context_);
    executing_ = false;
}

bool Runtime::boot(const unsigned char* script, size_t length) {
    if (context_) return false;
    context_ = duk_create_heap(allocate, reallocate, release, this, fatal);
    if (!context_) { snprintf(error_, sizeof(error_), "Cannot create 512 KiB JS heap"); return false; }
    startupScript_ = script;
    startupLength_ = length;
    executing_ = true;
    callStart_ = host_.micros();
    callBudget_ = 500000;
    int status = duk_safe_call(context_, protectedBoot, this, 0, 1);
    startupScript_ = nullptr;
    startupLength_ = 0;
    if (status != DUK_EXEC_SUCCESS) {
        captureError("boot");
        return false;
    }
    executing_ = false;
    duk_pop(context_);
    return true;
}

duk_ret_t Runtime::protectedBoot(duk_context* ctx, void* user) {
    Runtime& self = *static_cast<Runtime*>(user);
    self.bind();
    self.sync();
    // Compile as a global program, not strict eval: `var game` must remain global.
    duk_compile_lstring(ctx, 0, reinterpret_cast<const char*>(self.startupScript_), self.startupLength_);
    duk_call(ctx, 0);
    duk_pop(ctx);
    duk_get_global_string(ctx, "game");
    if (!duk_is_object(ctx, -1)) return duk_error(ctx, DUK_ERR_TYPE_ERROR, "Script must define global game with update() and draw()");
    for (const char* method : {"update", "draw"}) {
        duk_get_prop_string(ctx, -1, method);
        bool callable = duk_is_callable(ctx, -1);
        duk_pop(ctx);
        if (!callable) return duk_error(ctx, DUK_ERR_TYPE_ERROR, "game.%s must be a function", method);
    }
    duk_push_heap_stash(ctx);
    duk_dup(ctx, -2);
    duk_put_prop_string(ctx, -2, "game");
    duk_pop_2(ctx);
    self.invoke("init", true);
    return 0;
}

duk_ret_t Runtime::protectedSync(duk_context*, void* user) {
    static_cast<Runtime*>(user)->sync();
    return 0;
}

duk_ret_t Runtime::protectedCallback(duk_context*, void* user) {
    Runtime& self = *static_cast<Runtime*>(user);
    self.invoke(self.method_, self.optionalMethod_);
    return 0;
}

void Runtime::invoke(const char* method, bool optional) {
    duk_context* ctx = context_;
    duk_push_heap_stash(ctx);
    duk_get_prop_string(ctx, -1, "game");
    duk_remove(ctx, -2);
    duk_get_prop_string(ctx, -1, method);
    if (optional && duk_is_undefined(ctx, -1)) { duk_pop_2(ctx); return; }
    duk_dup(ctx, -2);  // this = game
    duk_remove(ctx, -3);
    duk_call_method(ctx, 0);
    duk_pop(ctx);
}

bool Runtime::call(const char* method, bool optional) {
    if (!healthy()) return false;
    duk_context* ctx = context_;
    method_ = method;
    optionalMethod_ = optional;
    callStart_ = host_.micros();
    callBudget_ = 100000;
    executing_ = true;
    if (duk_safe_call(ctx, protectedCallback, this, 0, 1) != DUK_EXEC_SUCCESS) {
        captureError(method);
        return false;
    }
    executing_ = false;
    duk_pop(ctx);
    return true;
}

bool Runtime::update(const InputState& state) {
    if (!healthy()) return false;
    input_ = state;
    uint32_t started = host_.micros();
    callStart_ = started;
    callBudget_ = 100000;
    executing_ = true;
    if (duk_safe_call(context_, protectedSync, this, 0, 1) != DUK_EXEC_SUCCESS) {
        captureError("input sync");
        return false;
    }
    executing_ = false;
    duk_pop(context_);
    bool success = call("update");
    updateMicros_ = host_.micros() - started;
    return success;
}

bool Runtime::draw() {
    if (!healthy()) return false;
    uint32_t started = host_.micros();
    bool success = call("draw");
    drawMicros_ = host_.micros() - started;
    if (success && (host_.top.overflowed() || host_.bottom.overflowed())) {
        snprintf(error_, sizeof(error_), "draw: top hardware renderer exceeded 1500 quads");
        host_.log(error_);
        return false;
    }
    return success;
}

}  // namespace ndsts

extern "C" int nds_ts_timeout_check(void* user) {
    return static_cast<ndsts::Runtime*>(user)->timedOut();
}
