#define _CRT_SECURE_NO_WARNINGS

#include "signature_verify.h"

#include "error_codes.h"
#include "sha256.h"
#include "monocypher-ed25519.h"

#include <stdio.h>
#include <string.h>

int mp716_sha256_start(void *ctx, size_t ctx_bytes)
{
	if (!ctx || ctx_bytes < sizeof(SHA256_CTX))
		return -1;
	sha256_init((SHA256_CTX *)ctx);
	return 0;
}

int mp716_sha256_feed(void *ctx, const uint8_t *data, size_t len)
{
	if (!ctx)
		return -1;
	sha256_update((SHA256_CTX *)ctx, data, len);
	return 0;
}

int mp716_sha256_finish(void *ctx, uint8_t out[32])
{
	if (!ctx || !out)
		return -1;
	sha256_final((SHA256_CTX *)ctx, out);
	return 0;
}

void mp716_sha256(const uint8_t *data, size_t len, uint8_t out[32])
{
	SHA256_CTX ctx;
	sha256_init(&ctx);
	sha256_update(&ctx, data, len);
	sha256_final(&ctx, out);
}

void mp716_hex32(const uint8_t in[32], char out[65])
{
	static const char hex[] = "0123456789abcdef";
	int i;

	for (i = 0; i < 32; i++) {
		out[i * 2] = hex[in[i] >> 4];
		out[i * 2 + 1] = hex[in[i] & 0x0f];
	}
	out[64] = 0;
}

static int hex_value(int c)
{
	if (c >= '0' && c <= '9')
		return c - '0';
	if (c >= 'a' && c <= 'f')
		return c - 'a' + 10;
	return -1;
}

int mp716_hex_decode_fixed(const char *text, size_t text_len, uint8_t *out, size_t out_len)
{
	size_t i;

	if (text_len != out_len * 2)
		return -1;
	for (i = 0; i < out_len; i++) {
		int hi = hex_value((unsigned char)text[i * 2]);
		int lo = hex_value((unsigned char)text[i * 2 + 1]);
		if (hi < 0 || lo < 0)
			return -1;
		out[i] = (uint8_t)((hi << 4) | lo);
	}
	return 0;
}

int mp716_load_pubkey(const char *path, uint8_t out[32])
{
	FILE *fp;
	uint8_t buf[128];
	size_t n;

	fp = fopen(path, "rb");
	if (!fp)
		return MP716_ERR_IO;
	n = fread(buf, 1, sizeof(buf), fp);
	fclose(fp);
	if (n == sizeof(buf))
		return MP716_ERR_IO;
	if (n == 32) {
		memcpy(out, buf, 32);
		return MP716_OK;
	}
	while (n && (buf[n - 1] == '\n' || buf[n - 1] == '\r' || buf[n - 1] == ' '))
		n--;
	if (mp716_hex_decode_fixed((const char *)buf, n, out, 32) != 0)
		return MP716_ERR_IO;
	return MP716_OK;
}

void mp716_key_id(const uint8_t pub[32], char out[17])
{
	uint8_t hash[32];
	char hex[65];

	mp716_sha256(pub, 32, hash);
	mp716_hex32(hash, hex);
	memcpy(out, hex, 16);
	out[16] = 0;
}

int mp716_ed25519_verify(const uint8_t pub[32], const uint8_t sig[64], const uint8_t *msg, size_t msg_len)
{
	if (crypto_ed25519_check(sig, pub, msg, msg_len) != 0)
		return MP716_ERR_SIGNATURE;
	return MP716_OK;
}
