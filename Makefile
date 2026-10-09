BLOCKSDS ?= /opt/blocksds/core
WONDERFUL_TOOLCHAIN ?= /opt/wonderful
PREFIX := $(WONDERFUL_TOOLCHAIN)/toolchain/gcc-arm-none-eabi/bin/arm-none-eabi-
CC := $(PREFIX)gcc
CXX := $(PREFIX)g++
ARCH := -mthumb -mcpu=arm946e-s+nofp
SPECS := -specs=$(BLOCKSDS)/sys/crts/ds_arm9.specs
INCLUDES := -Inative -Ivendor/duktape -Igen -I$(BLOCKSDS)/libs/libnds/include
DEFINES := -D__NDS__ -D__BLOCKSDS__ -DARM9
FLAGS := $(ARCH) $(SPECS) $(INCLUDES) $(DEFINES) -O2 -ffunction-sections -fdata-sections -Wall -Wextra
CFLAGS := $(FLAGS) -std=gnu99 -Wno-unused-function -Wno-unused-but-set-variable
CXXFLAGS := $(FLAGS) -std=gnu++17 -fno-exceptions -fno-rtti -fno-threadsafe-statics
OBJECTS := build/main.o build/runtime.o build/graphics.o build/duktape.o
ELF := build/nds-ts-demo.elf
ROM := build/nds-ts-demo.nds

.PHONY: all clean
all: $(ROM)

$(ROM): $(ELF)
	$(BLOCKSDS)/tools/ndstool/ndstool -c $@ -7 $(BLOCKSDS)/sys/arm7/main_core/arm7_minimal.elf -9 $< \
		-g "####" "00" "NDS-TS DEMO" -bt 1 "NDS-TS Demo;TypeScript game engine;nds-ts contributors"

$(ELF): $(OBJECTS)
	$(CC) $(ARCH) $(SPECS) -Wl,-Map,build/nds-ts-demo.map -Wl,--gc-sections -o $@ $^ \
		-L$(BLOCKSDS)/libs/libnds/lib -Wl,--start-group -lnds9 -lstdc++ -lc -lm -Wl,--end-group
	$(PREFIX)size $@

build/%.o: native/%.cpp gen/script_gen.h gen/font_gen.h Makefile
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

# Bitmap loops benefit from ARM instructions on the ARM9; scripts remain portable.
build/graphics.o: native/graphics.cpp gen/font_gen.h Makefile
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -marm -MMD -MP -c $< -o $@

build/duktape.o: vendor/duktape/duktape.c vendor/duktape/duktape.h vendor/duktape/duk_config.h Makefile
	@mkdir -p build
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

clean:
	rm -rf build

-include $(OBJECTS:.o=.d)
