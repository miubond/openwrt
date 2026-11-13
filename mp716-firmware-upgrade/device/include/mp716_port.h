#ifndef MP716_PORT_H
#define MP716_PORT_H

#include <stdio.h>
#include <stdint.h>

int mp716_file_size(FILE *fp, uint64_t *out);
int mp716_exclusive_create(const char *path);
int mp716_remove_file(const char *path);
int mp716_replace_file(const char *tmp, const char *dst);
int mp716_join(char *out, size_t out_len, const char *dir, const char *name);

#endif
