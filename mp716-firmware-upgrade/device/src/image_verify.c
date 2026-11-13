#define _CRT_SECURE_NO_WARNINGS

#include "image_verify.h"

#include "error_codes.h"
#include "mp716_format.h"
#include "mp716_port.h"
#include "sha256.h"
#include "signature_verify.h"

#include <stdlib.h>
#include <string.h>

static uint32_t rdbe32(const uint8_t *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

static uint32_t rdle32(const uint8_t *p)
{
	return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t rdle16(const uint8_t *p)
{
	return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

uint32_t mp716_crc32_begin(void)
{
	return 0xffffffffu;
}

void mp716_crc32_feed(uint32_t *crc, const uint8_t *data, size_t len)
{
	static uint32_t table[256];
	static int ready;
	size_t i;

	if (!ready) {
		uint32_t n;
		for (n = 0; n < 256; n++) {
			uint32_t c = n;
			int bit;
			for (bit = 0; bit < 8; bit++)
				c = (c & 1u) ? (0xedb88320u ^ (c >> 1)) : (c >> 1);
			table[n] = c;
		}
		ready = 1;
	}
	for (i = 0; i < len; i++)
		*crc = table[(*crc ^ data[i]) & 0xffu] ^ (*crc >> 8);
}

uint32_t mp716_crc32_end(uint32_t crc)
{
	return crc ^ 0xffffffffu;
}

uint32_t mp716_crc32(const uint8_t *data, size_t len)
{
	uint32_t crc = mp716_crc32_begin();
	mp716_crc32_feed(&crc, data, len);
	return mp716_crc32_end(crc);
}

static int fail_detail(char *detail, size_t detail_len, int code, const char *text)
{
	if (detail && detail_len)
		snprintf(detail, detail_len, "%s", text);
	return code;
}

static int parse_string(const uint8_t **pp, const uint8_t *end, char *out, size_t cap)
{
	const uint8_t *p = *pp;
	size_t n = 0;

	if (p >= end || *p != '"')
		return -1;
	p++;
	while (p < end) {
		unsigned char c = *p++;
		if (c == '"') {
			out[n] = 0;
			*pp = p;
			return 0;
		}
		if (c == '\\') {
			if (p >= end)
				return -1;
			c = *p++;
			if (c == '"' || c == '\\' || c == '/')
				;
			else if (c == 'n')
				c = '\n';
			else if (c == 'r')
				c = '\r';
			else if (c == 't')
				c = '\t';
			else
				return -1;
		} else if (c < 0x20 || c > 0x7e) {
			return -1;
		}
		if (n + 1 >= cap)
			return -1;
		out[n++] = (char)c;
	}
	return -1;
}

static int parse_u32(const uint8_t **pp, const uint8_t *end, uint32_t *out)
{
	const uint8_t *p = *pp;
	uint64_t value = 0;
	int digits = 0;

	if (p >= end || *p < '0' || *p > '9')
		return -1;
	if (*p == '0' && (p + 1) < end && p[1] >= '0' && p[1] <= '9')
		return -1;
	while (p < end && *p >= '0' && *p <= '9') {
		value = value * 10u + (uint64_t)(*p - '0');
		if (value > 0xffffffffull)
			return -1;
		p++;
		digits++;
	}
	if (digits == 0)
		return -1;
	*out = (uint32_t)value;
	*pp = p;
	return 0;
}

static int parse_bool(const uint8_t **pp, const uint8_t *end, int *out)
{
	const uint8_t *p = *pp;
	if ((size_t)(end - p) >= 4 && memcmp(p, "true", 4) == 0) {
		*out = 1;
		*pp = p + 4;
		return 0;
	}
	if ((size_t)(end - p) >= 5 && memcmp(p, "false", 5) == 0) {
		*out = 0;
		*pp = p + 5;
		return 0;
	}
	return -1;
}

static int hex_ok(const char *text, size_t expect)
{
	size_t i;
	if (strlen(text) != expect)
		return 0;
	for (i = 0; i < expect; i++) {
		char c = text[i];
		if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
			return 0;
	}
	return 1;
}

static int forbidden_hardware(const char *text)
{
	char lower[40];
	size_t n = strlen(text);
	size_t i;
	static const char *bad[] = {
		"validated-revision", "placeholder", "todo", "changeme", "unverified",
		"unknown", "none", "mp716", "test", NULL
	};
	if (n == 0 || n >= sizeof(lower))
		return 1;
	for (i = 0; i < n; i++) {
		char c = text[i];
		if (c >= 'A' && c <= 'Z')
			c = (char)(c - 'A' + 'a');
		lower[i] = c;
	}
	lower[n] = 0;
	for (i = 0; bad[i]; i++) {
		if (strcmp(lower, bad[i]) == 0)
			return 1;
	}
	return 0;
}

static int build_time_ok(const char *text)
{
	static const char pattern[] = "NNNN-NN-NNTNN:NN:NNZ";
	int i, month, day, hour, minute, second;
	if (strlen(text) != 20)
		return 0;
	for (i = 0; i < 20; i++) {
		if (pattern[i] == 'N') {
			if (text[i] < '0' || text[i] > '9')
				return 0;
		} else if (text[i] != pattern[i]) {
			return 0;
		}
	}
	month = (text[5] - '0') * 10 + (text[6] - '0');
	day = (text[8] - '0') * 10 + (text[9] - '0');
	hour = (text[11] - '0') * 10 + (text[12] - '0');
	minute = (text[14] - '0') * 10 + (text[15] - '0');
	second = (text[17] - '0') * 10 + (text[18] - '0');
	return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 60;
}

enum {
	F_ALLOW = 1u << 0,
	F_BASE = 1u << 1,
	F_TIME = 1u << 2,
	F_CUSTOM = 1u << 3,
	F_FIRMWARE = 1u << 4,
	F_FORMAT = 1u << 5,
	F_HW = 1u << 6,
	F_TYPE = 1u << 7,
	F_HASH = 1u << 8,
	F_SIZE = 1u << 9,
	F_PRODUCT = 1u << 10,
	F_KEY = 1u << 11,
	F_ENGINE = 1u << 12,
	F_WEB = 1u << 13,
	F_ALL = (1u << 14) - 1u
};

int mp716_manifest_parse(const uint8_t *raw, uint32_t len, struct mp716_manifest *out, char *detail, size_t detail_len)
{
	const uint8_t *p;
	const uint8_t *end;
	char previous[40];
	unsigned seen = 0;
	uint32_t i;

	memset(out, 0, sizeof(*out));
	if (len == 0 || len > MP716_MANIFEST_MAX)
		return fail_detail(detail, detail_len, MP716_ERR_SIZE, "manifest length is not allowed");
	for (i = 0; i < len; i++) {
		if (raw[i] <= 0x20 || raw[i] >= 0x7f)
			return fail_detail(detail, detail_len, MP716_ERR_NOT_CANONICAL, "manifest is not canonical ASCII");
	}
	p = raw;
	end = raw + len;
	if (*p != '{')
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest is not an object");
	p++;
	previous[0] = 0;
	if (p < end && *p == '}')
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest is missing fields");
	while (p < end) {
		char key[40];
		unsigned bit = 0;
		if (parse_string(&p, end, key, sizeof(key)) != 0 || p >= end || *p != ':')
			return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest field is malformed");
		p++;
		if (previous[0] && strcmp(previous, key) >= 0)
			return fail_detail(detail, detail_len, MP716_ERR_NOT_CANONICAL, "manifest keys are not strictly sorted");
		snprintf(previous, sizeof(previous), "%s", key);
		if (strcmp(key, "allow_downgrade") == 0) {
			bit = F_ALLOW;
			if (parse_bool(&p, end, &out->allow_downgrade) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "allow_downgrade is not a boolean");
		} else if (strcmp(key, "base_firmware") == 0) {
			bit = F_BASE;
			if (parse_string(&p, end, out->base_firmware, sizeof(out->base_firmware)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "base_firmware is malformed");
		} else if (strcmp(key, "build_time") == 0) {
			bit = F_TIME;
			if (parse_string(&p, end, out->build_time, sizeof(out->build_time)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "build_time is malformed");
		} else if (strcmp(key, "custom_firmware") == 0) {
			bit = F_CUSTOM;
			if (parse_string(&p, end, out->custom_firmware, sizeof(out->custom_firmware)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "custom_firmware is malformed");
		} else if (strcmp(key, "firmware_version") == 0) {
			bit = F_FIRMWARE;
			if (parse_string(&p, end, out->firmware_version, sizeof(out->firmware_version)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "firmware_version is malformed");
		} else if (strcmp(key, "format_version") == 0) {
			uint32_t version = 0;
			bit = F_FORMAT;
			if (parse_u32(&p, end, &version) != 0 || version != 1)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "format_version is not 1");
		} else if (strcmp(key, "hardware_revision") == 0) {
			bit = F_HW;
			if (parse_string(&p, end, out->hardware_revision, sizeof(out->hardware_revision)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "hardware_revision is malformed");
		} else if (strcmp(key, "image_type") == 0) {
			bit = F_TYPE;
			if (parse_string(&p, end, out->image_type, sizeof(out->image_type)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "image_type is malformed");
		} else if (strcmp(key, "payload_sha256") == 0) {
			bit = F_HASH;
			if (parse_string(&p, end, out->payload_sha256, sizeof(out->payload_sha256)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "payload_sha256 is malformed");
		} else if (strcmp(key, "payload_size") == 0) {
			bit = F_SIZE;
			if (parse_u32(&p, end, &out->payload_size) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "payload_size is malformed");
		} else if (strcmp(key, "product") == 0) {
			bit = F_PRODUCT;
			if (parse_string(&p, end, out->product, sizeof(out->product)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "product is malformed");
		} else if (strcmp(key, "signing_key_id") == 0) {
			bit = F_KEY;
			if (parse_string(&p, end, out->signing_key_id, sizeof(out->signing_key_id)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "signing_key_id is malformed");
		} else if (strcmp(key, "upgrade_engine") == 0) {
			bit = F_ENGINE;
			if (parse_string(&p, end, out->upgrade_engine, sizeof(out->upgrade_engine)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "upgrade_engine is malformed");
		} else if (strcmp(key, "web_ui") == 0) {
			bit = F_WEB;
			if (parse_string(&p, end, out->web_ui, sizeof(out->web_ui)) != 0)
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "web_ui is malformed");
		} else {
			return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest has an unknown field");
		}
		if (seen & bit)
			return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest repeats a field");
		seen |= bit;
		if (p < end && *p == ',') {
			p++;
			if (p >= end || *p == '}')
				return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest has a trailing comma");
			continue;
		}
		if (p < end && *p == '}') {
			p++;
			break;
		}
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest field separator is missing");
	}
	if (p != end)
		return fail_detail(detail, detail_len, MP716_ERR_TRAILING, "manifest has trailing data");
	if (seen != F_ALL)
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "manifest fields do not match the schema");
	if (strcmp(out->product, "MP716") != 0)
		return fail_detail(detail, detail_len, MP716_ERR_PRODUCT, "product is not MP716");
	if (strcmp(out->image_type, "vendor-compatible") != 0)
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "image_type is not vendor-compatible");
	if (forbidden_hardware(out->hardware_revision))
		return fail_detail(detail, detail_len, MP716_ERR_HW_REVISION, "hardware revision is empty or a placeholder");
	if (out->base_firmware[0] == 0)
		return fail_detail(detail, detail_len, MP716_ERR_BASE_FIRMWARE, "base firmware is empty");
	{
		int version[3];
		if (mp716_semver_parse(out->firmware_version, version) != 0 ||
		    mp716_semver_parse(out->custom_firmware, version) != 0 ||
		    mp716_semver_parse(out->web_ui, version) != 0 ||
		    mp716_semver_parse(out->upgrade_engine, version) != 0)
			return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "version is not major.minor.patch");
	}
	if (strcmp(out->custom_firmware, out->firmware_version) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "custom_firmware and firmware_version differ");
	if (!hex_ok(out->payload_sha256, 64))
		return fail_detail(detail, detail_len, MP716_ERR_HASH, "payload_sha256 is not lowercase hex");
	if (!hex_ok(out->signing_key_id, 16))
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "signing_key_id is not 16 lowercase hex characters");
	if (!build_time_ok(out->build_time))
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "build_time is not UTC YYYY-MM-DDTHH:MM:SSZ");
	if (out->payload_size == 0 || out->payload_size > MP716_FIRMWARE_BYTES)
		return fail_detail(detail, detail_len, MP716_ERR_MANIFEST, "payload_size is not a payload length");
	return MP716_OK;
}

struct scan_state {
	int phase;
	uint8_t header[64];
	uint32_t header_got;
	uint32_t payload_size;
	uint32_t payload_got;
	uint32_t kernel_size;
	uint32_t kernel_got;
	uint32_t kernel_crc;
	uint32_t expect_dcrc;
	uint8_t lzma[13];
	uint32_t lzma_got;
	int structure_error;
	int squash_found;
	uint32_t squash_off;
	uint8_t superblock[64];
	uint32_t super_got;
	int need_super;
	uint8_t overlap[3];
	int overlap_len;
	uint32_t tail_pos;
	char name[33];
	uint32_t lzma_dictionary;
};

static int power_of_two(uint32_t value)
{
	return value && (value & (value - 1u)) == 0;
}

static void note_structure(struct scan_state *scan, int code)
{
	if (scan->structure_error == 0)
		scan->structure_error = code;
	scan->phase = 3;
}

static void parse_superblock(struct scan_state *scan)
{
	uint32_t magic, block_size, bytes_lo, bytes_hi;
	uint16_t compression, block_log, major;

	magic = rdle32(scan->superblock);
	block_size = rdle32(scan->superblock + 12);
	compression = rdle16(scan->superblock + 20);
	block_log = rdle16(scan->superblock + 22);
	major = rdle16(scan->superblock + 28);
	bytes_lo = rdle32(scan->superblock + 40);
	bytes_hi = rdle32(scan->superblock + 44);
	if (magic != MP716_SQUASHFS_MAGIC || major != MP716_SQUASHFS_MAJOR || compression != MP716_SQUASHFS_XZ) {
		note_structure(scan, MP716_ERR_ROOTFS);
		return;
	}
	if (block_size < 4096 || block_size > 1024u * 1024u || !power_of_two(block_size)) {
		note_structure(scan, MP716_ERR_ROOTFS);
		return;
	}
	{
		uint16_t logv = 0;
		uint32_t walk = block_size;
		while (walk > 1) {
			walk >>= 1;
			logv++;
		}
		if (block_log != logv || bytes_hi != 0 || bytes_lo < 96 ||
		    scan->squash_off > scan->payload_size || bytes_lo > scan->payload_size - scan->squash_off) {
			note_structure(scan, MP716_ERR_ROOTFS);
			return;
		}
	}
}

static void parse_uimage(struct scan_state *scan)
{
	uint8_t zeroed[64];
	uint32_t size;
	uint32_t i;

	if (rdbe32(scan->header) != MP716_IH_MAGIC) {
		note_structure(scan, MP716_ERR_UIMAGE);
		return;
	}
	memcpy(zeroed, scan->header, 64);
	memset(zeroed + 4, 0, 4);
	if (mp716_crc32(zeroed, 64) != rdbe32(scan->header + 4)) {
		note_structure(scan, MP716_ERR_UIMAGE);
		return;
	}
	size = rdbe32(scan->header + 12);
	scan->expect_dcrc = rdbe32(scan->header + 24);
	if (scan->header[28] != MP716_IH_OS_LINUX || scan->header[29] != MP716_IH_ARCH_MIPS ||
	    scan->header[30] != MP716_IH_TYPE_KERNEL || scan->header[31] != MP716_IH_COMP_LZMA) {
		note_structure(scan, MP716_ERR_UIMAGE);
		return;
	}
	if (size < 13 || (uint64_t)64 + size + 96 > scan->payload_size) {
		note_structure(scan, MP716_ERR_UIMAGE);
		return;
	}
	scan->kernel_size = size;
	scan->kernel_crc = mp716_crc32_begin();
	for (i = 0; i < 32 && scan->header[32 + i]; i++)
		scan->name[i] = (char)scan->header[32 + i];
	scan->name[i] = 0;
	scan->phase = 1;
}

static int lzma_ok(const uint8_t prefix[13], uint32_t *dictionary)
{
	unsigned props = prefix[0];
	unsigned lc = props % 9u;
	unsigned rest = props / 9u;
	unsigned lp = rest % 5u;
	unsigned pb = rest / 5u;
	uint32_t dict = rdle32(prefix + 1);
	if (pb > 4 || lc + lp > 4)
		return 0;
	if (dict < 4096 || dict > 8u * 1024u * 1024u || !power_of_two(dict))
		return 0;
	*dictionary = dict;
	return 1;
}

static void absorb_tail(struct scan_state *scan, const uint8_t *data, uint32_t len)
{
	uint8_t window[MP716_IO_CHUNK + 3];
	uint32_t total;
	uint32_t base;
	uint32_t i;

	if (scan->need_super && scan->super_got < 48) {
		uint32_t need = 48 - scan->super_got;
		uint32_t take = len < need ? len : need;
		memcpy(scan->superblock + scan->super_got, data, take);
		scan->super_got += take;
		if (scan->super_got >= 48) {
			scan->need_super = 0;
			parse_superblock(scan);
		}
	}
	memcpy(window, scan->overlap, (size_t)scan->overlap_len);
	memcpy(window + scan->overlap_len, data, len);
	total = (uint32_t)scan->overlap_len + len;
	base = scan->tail_pos - (uint32_t)scan->overlap_len;
	if (!scan->squash_found) {
		for (i = 0; i + 4 <= total; i++) {
			if (memcmp(window + i, "hsqs", 4) == 0) {
				uint32_t avail = total - i;
				scan->squash_found = 1;
				scan->squash_off = base + i;
				scan->super_got = avail > 64 ? 64 : avail;
				memcpy(scan->superblock, window + i, scan->super_got);
				scan->need_super = scan->super_got < 48;
				if (!scan->need_super)
					parse_superblock(scan);
				break;
			}
		}
	}
	if (total >= 3) {
		memcpy(scan->overlap, window + total - 3, 3);
		scan->overlap_len = 3;
	} else {
		memcpy(scan->overlap, window, total);
		scan->overlap_len = (int)total;
	}
	scan->tail_pos += len;
}

static void feed_scan(struct scan_state *scan, const uint8_t *data, uint32_t len)
{
	uint32_t index = 0;
	while (index < len) {
		if (scan->phase == 3) {
			scan->payload_got += len - index;
			return;
		}
		if (scan->phase == 0) {
			uint32_t take = 64 - scan->header_got;
			if (take > len - index)
				take = len - index;
			memcpy(scan->header + scan->header_got, data + index, take);
			scan->header_got += take;
			index += take;
			scan->payload_got += take;
			if (scan->header_got == 64)
				parse_uimage(scan);
		} else if (scan->phase == 1) {
			uint32_t need = scan->kernel_size - scan->kernel_got;
			uint32_t take = need > len - index ? len - index : need;
			mp716_crc32_feed(&scan->kernel_crc, data + index, take);
			if (scan->lzma_got < 13) {
				uint32_t copy = 13 - scan->lzma_got;
				if (copy > take)
					copy = take;
				memcpy(scan->lzma + scan->lzma_got, data + index, copy);
				scan->lzma_got += copy;
			}
			scan->kernel_got += take;
			index += take;
			scan->payload_got += take;
			if (scan->kernel_got == scan->kernel_size) {
				if (mp716_crc32_end(scan->kernel_crc) != scan->expect_dcrc ||
				    !lzma_ok(scan->lzma, &scan->lzma_dictionary)) {
					note_structure(scan, MP716_ERR_UIMAGE);
				} else {
					scan->phase = 2;
					scan->tail_pos = scan->payload_got;
				}
			}
		} else {
			uint32_t take = len - index;
			absorb_tail(scan, data + index, take);
			index += take;
			scan->payload_got += take;
		}
	}
}

static void finish_scan(struct scan_state *scan)
{
	if (scan->structure_error)
		return;
	if (scan->phase != 2 || !scan->squash_found || scan->need_super)
		note_structure(scan, MP716_ERR_ROOTFS);
}

static int parse_header(const uint8_t header[64], uint32_t *manifest_size, uint32_t *payload_size, char *detail, size_t detail_len)
{
	uint32_t version, header_size, flags, i;
	uint64_t total;
	if (memcmp(header, MP716_MAGIC, MP716_MAGIC_LEN) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_MAGIC, "magic is not MP716UPD");
	version = rdle32(header + 8);
	header_size = rdle32(header + 12);
	*manifest_size = rdle32(header + 16);
	*payload_size = rdle32(header + 20);
	flags = rdle32(header + 24);
	if (version != MP716_FORMAT_VERSION)
		return fail_detail(detail, detail_len, MP716_ERR_VERSION, "unsupported format version");
	if (header_size != MP716_HEADER_BYTES || flags != 0)
		return fail_detail(detail, detail_len, MP716_ERR_FORMAT, "header flags or size are not valid");
	for (i = 28; i < 64; i++) {
		if (header[i] != 0)
			return fail_detail(detail, detail_len, MP716_ERR_FORMAT, "header reserved bytes are not zero");
	}
	total = 64ull + (uint64_t)(*manifest_size) + (uint64_t)(*payload_size) + 64ull;
	if (total > 0xffffffffull)
		return fail_detail(detail, detail_len, MP716_ERR_OVERFLOW, "declared lengths overflow");
	if (*manifest_size == 0 || *manifest_size > MP716_MANIFEST_MAX || *payload_size == 0 || *payload_size > MP716_FIRMWARE_BYTES)
		return fail_detail(detail, detail_len, MP716_ERR_SIZE, "declared lengths are not allowed");
	return MP716_OK;
}

static int check_profile(const struct mp716_manifest *manifest, const struct mp716_profile *profile,
			 int operator_allow_downgrade, char *detail, size_t detail_len)
{
	int installed[3], next[3];
	if (strcmp(profile->product, "MP716") != 0 || strcmp(manifest->product, profile->product) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_PRODUCT, "image product does not match the device");
	if (strcmp(manifest->hardware_revision, profile->hardware_revision) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_HW_REVISION, "hardware revision does not match the device profile");
	if (strcmp(manifest->base_firmware, profile->base_firmware) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_BASE_FIRMWARE, "base firmware does not match the device");
	if (strcmp(profile->vendor_software_version, profile->base_firmware) != 0)
		return fail_detail(detail, detail_len, MP716_ERR_VERSION, "profile vendor version and base firmware disagree");
	if (profile->installed_custom_firmware[0]) {
		if (mp716_semver_parse(profile->installed_custom_firmware, installed) != 0 ||
		    mp716_semver_parse(manifest->firmware_version, next) != 0)
			return fail_detail(detail, detail_len, MP716_ERR_VERSION, "installed custom version is not semantic");
		if (next[0] < installed[0] || (next[0] == installed[0] && next[1] < installed[1]) ||
		    (next[0] == installed[0] && next[1] == installed[1] && next[2] <= installed[2])) {
			if (!(manifest->allow_downgrade && operator_allow_downgrade))
				return fail_detail(detail, detail_len, MP716_ERR_DOWNGRADE, "image is not newer than the installed custom firmware");
		}
	}
	return MP716_OK;
}

int mp716_verify_image(const char *image_path, const char *pubkey_path, const struct mp716_profile *profile,
		       const char *meminfo_path, int require_memory, int operator_allow_downgrade,
		       struct mp716_report *report)
{
	FILE *fp = NULL;
	uint8_t *manifest_bytes = NULL;
	uint8_t *message = NULL;
	uint8_t header[64];
	uint8_t signature[64];
	uint8_t digest[32];
	uint8_t pubkey[32];
	char key_id[17];
	struct mp716_manifest manifest;
	struct scan_state scan;
	SHA256_CTX sha;
	uint64_t file_size = 0;
	uint32_t manifest_size = 0, payload_size = 0;
	uint32_t remaining;
	char detail[180];
	int rc;

	detail[0] = 0;
	fp = fopen(image_path, "rb");
	if (!fp)
		return (report->code = MP716_ERR_IO), mp716_report_fail(report, MP716_ERR_IO, "image cannot be read"), MP716_ERR_IO;
	if (mp716_file_size(fp, &file_size) != MP716_OK) {
		rc = MP716_ERR_IO;
		mp716_report_fail(report, rc, "image length cannot be read");
		goto done;
	}
	if (file_size < MP716_HEADER_BYTES + MP716_SIGNATURE_BYTES) {
		rc = MP716_ERR_TRUNCATED;
		mp716_report_fail(report, rc, "file is shorter than a header and signature");
		goto done;
	}
	if (fread(header, 1, 64, fp) != 64) {
		rc = MP716_ERR_TRUNCATED;
		mp716_report_fail(report, rc, "header is short");
		goto done;
	}
	rc = parse_header(header, &manifest_size, &payload_size, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		goto done;
	}
	if (file_size < 64ull + manifest_size + payload_size + 64ull) {
		rc = MP716_ERR_TRUNCATED;
		mp716_report_fail(report, rc, "file is shorter than the lengths in the header");
		goto done;
	}
	if (file_size > 64ull + manifest_size + payload_size + 64ull) {
		rc = MP716_ERR_TRAILING;
		mp716_report_fail(report, rc, "file has bytes after the signature");
		goto done;
	}
	manifest_bytes = (uint8_t *)malloc(manifest_size);
	message = (uint8_t *)malloc((size_t)64 + manifest_size + 32);
	if (!manifest_bytes || !message) {
		rc = MP716_ERR_LOW_MEMORY;
		mp716_report_fail(report, rc, "verifier could not allocate the manifest buffer");
		goto done;
	}
	if (fread(manifest_bytes, 1, manifest_size, fp) != manifest_size) {
		rc = MP716_ERR_TRUNCATED;
		mp716_report_fail(report, rc, "manifest is short");
		goto done;
	}
	rc = mp716_manifest_parse(manifest_bytes, manifest_size, &manifest, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		goto done;
	}
	snprintf(report->product, sizeof(report->product), "%s", manifest.product);
	snprintf(report->hardware_revision, sizeof(report->hardware_revision), "%s", manifest.hardware_revision);
	snprintf(report->firmware_version, sizeof(report->firmware_version), "%s", manifest.firmware_version);
	snprintf(report->base_firmware, sizeof(report->base_firmware), "%s", manifest.base_firmware);
	snprintf(report->custom_firmware, sizeof(report->custom_firmware), "%s", manifest.custom_firmware);
	snprintf(report->web_ui, sizeof(report->web_ui), "%s", manifest.web_ui);
	snprintf(report->upgrade_engine, sizeof(report->upgrade_engine), "%s", manifest.upgrade_engine);
	report->payload_size = payload_size;
	memset(&scan, 0, sizeof(scan));
	scan.payload_size = payload_size;
	sha256_init(&sha);
	remaining = payload_size;
	while (remaining) {
		uint8_t chunk[MP716_IO_CHUNK];
		uint32_t ask = remaining > MP716_IO_CHUNK ? MP716_IO_CHUNK : remaining;
		size_t got = fread(chunk, 1, ask, fp);
		if (got != ask) {
			rc = MP716_ERR_TRUNCATED;
			mp716_report_fail(report, rc, "payload ended early");
			goto done;
		}
		sha256_update(&sha, chunk, got);
		feed_scan(&scan, chunk, (uint32_t)got);
		remaining -= (uint32_t)got;
	}
	sha256_final(&sha, digest);
	mp716_hex32(digest, report->payload_sha256);
	finish_scan(&scan);
	if (strcmp(manifest.payload_sha256, report->payload_sha256) != 0 || manifest.payload_size != payload_size) {
		rc = MP716_ERR_HASH;
		mp716_report_fail(report, rc, "manifest hash does not match the payload");
		goto done;
	}
	if (fread(signature, 1, 64, fp) != 64) {
		rc = MP716_ERR_TRUNCATED;
		mp716_report_fail(report, rc, "signature is short");
		goto done;
	}
	memcpy(message, header, 64);
	memcpy(message + 64, manifest_bytes, manifest_size);
	memcpy(message + 64 + manifest_size, digest, 32);
	rc = mp716_load_pubkey(pubkey_path, pubkey);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "public key cannot be read");
		goto done;
	}
	mp716_key_id(pubkey, key_id);
	if (strcmp(key_id, manifest.signing_key_id) != 0) {
		rc = MP716_ERR_SIGNATURE;
		mp716_report_fail(report, rc, "signing key id does not match this public key");
		goto done;
	}
	rc = mp716_ed25519_verify(pubkey, signature, message, (size_t)64 + manifest_size + 32);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "Ed25519 signature rejected the image");
		goto done;
	}
	report->signature_checked = 1;
	rc = check_profile(&manifest, profile, operator_allow_downgrade, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		goto done;
	}
	if (scan.structure_error) {
		rc = scan.structure_error;
		mp716_report_fail(report, rc, rc == MP716_ERR_ROOTFS ? "rootfs structure is not SquashFS v4 XZ" : "uImage structure is not valid");
		goto done;
	}
	report->squashfs_offset = scan.squash_off;
	report->historical_offset_match = scan.squash_off == MP716_HISTORICAL_SQUASHFS_OFFSET;
	report->lzma_dictionary = scan.lzma_dictionary;
	snprintf(report->uimage_name, sizeof(report->uimage_name), "%s", scan.name);
	if (require_memory) {
		int available = 0;
		if (!meminfo_path) {
			rc = MP716_ERR_LOW_MEMORY;
			mp716_report_fail(report, rc, "memory budget was required but meminfo is missing");
			goto done;
		}
		rc = mp716_meminfo_available_kib(meminfo_path, &available, detail, sizeof(detail));
		if (rc != MP716_OK) {
			mp716_report_fail(report, rc, detail);
			goto done;
		}
		report->memory_available_kib = available;
		report->memory_checked = 1;
		if (!mp716_memory_allows(available, payload_size, "verify")) {
			rc = MP716_ERR_LOW_MEMORY;
			mp716_report_fail(report, rc, "not enough free memory to verify");
			goto done;
		}
	}
	snprintf(report->vendor_software_version, sizeof(report->vendor_software_version), "%s", profile->vendor_software_version);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	report->detail[0] = 0;
	report->upgraded = 0;
	rc = MP716_OK;
done:
	free(manifest_bytes);
	free(message);
	if (fp)
		fclose(fp);
	return rc;
}
