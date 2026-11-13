#ifndef MP716_SIGNATURE_VERIFY_H
#define MP716_SIGNATURE_VERIFY_H

#include <stddef.h>
#include <stdint.h>

int mp716_sha256_start(void *ctx, size_t ctx_bytes);
int mp716_sha256_feed(void *ctx, const uint8_t *data, size_t len);
int mp716_sha256_finish(void *ctx, uint8_t out[32]);
void mp716_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
void mp716_hex32(const uint8_t in[32], char out[65]);

int mp716_hex_decode_fixed(const char *text, size_t text_len, uint8_t *out, size_t out_len);
int mp716_load_pubkey(const char *path, uint8_t out[32]);
void mp716_key_id(const uint8_t pub[32], char out[17]);
int mp716_ed25519_verify(const uint8_t pub[32], const uint8_t sig[64], const uint8_t *msg, size_t msg_len);

#endif
