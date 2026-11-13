CC ?= gcc
HOST ?= 0
BUILD := build
CFLAGS_EXTRA ?=
CFLAGS := -std=c99 -Wall -Wextra -Os -D_POSIX_C_SOURCE=200809L -D_FILE_OFFSET_BITS=64 $(CFLAGS_EXTRA) -Iinclude -I../shared -Ithird_party/monocypher -Ithird_party/sha256
ifeq ($(HOST),1)
CFLAGS += -DMP716_HOST -D_CRT_SECURE_NO_WARNINGS
endif

COMMON := src/mp716_port.c src/system_info.c src/signature_verify.c src/image_verify.c \
	src/upgrade_state.c src/mtd_backend.c src/upgrade_manager.c \
	third_party/sha256/sha256.c third_party/monocypher/monocypher.c \
	third_party/monocypher/monocypher-ed25519.c

.PHONY: all clean
all: $(BUILD)/mp716-upgraded $(BUILD)/mp716-upgrade.cgi

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/mp716-upgraded: $(COMMON) src/main.c | $(BUILD)
	$(CC) $(CFLAGS) $(COMMON) src/main.c -o $@

$(BUILD)/mp716-upgrade.cgi: $(COMMON) ../cgi/mp716_upgrade.c | $(BUILD)
	$(CC) $(CFLAGS) $(COMMON) ../cgi/mp716_upgrade.c -o $@

clean:
	rm -rf $(BUILD)
