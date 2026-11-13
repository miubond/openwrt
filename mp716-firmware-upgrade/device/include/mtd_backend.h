#ifndef MP716_MTD_BACKEND_H
#define MP716_MTD_BACKEND_H

#include <stdint.h>

#include "system_info.h"

struct mp716_fault {
	int power_cut_after; /* -1 disabled; otherwise payload bytes programmed before the cut */
	int io_error_at;     /* -1 disabled; otherwise payload offset that returns IO */
};

/* Fake SPI NOR partition. The file must already exist, end in .fakemtd, and be
 * exactly the firmware partition size. This does not open a kernel MTD device. */
int mp716_fake_apply(const char *path, FILE *payload, uint32_t payload_len, const uint8_t expected_sha[32],
		     struct mp716_report *report);
int mp716_nor_program(const char *path, uint32_t offset, const uint8_t *data, uint32_t len);

#endif
