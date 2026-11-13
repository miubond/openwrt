#ifndef MP716_FORMAT_H
#define MP716_FORMAT_H

#include <stdint.h>

#define MP716_MAGIC "MP716UPD"
#define MP716_MAGIC_LEN 8
#define MP716_FORMAT_VERSION 1u
#define MP716_HEADER_BYTES 64u
#define MP716_SIGNATURE_BYTES 64u
#define MP716_MANIFEST_MAX 8192u
#define MP716_FIRMWARE_OFFSET 0x00050000u
#define MP716_FIRMWARE_BYTES 0x007B0000u
#define MP716_HISTORICAL_SQUASHFS_OFFSET 0x0012DB89u
#define MP716_UPLOAD_RESERVE_BYTES (8u * 1024u * 1024u)
#define MP716_VERIFY_RESERVE_BYTES (2u * 1024u * 1024u)
#define MP716_IO_CHUNK 4096u

/* uImage / SquashFS gates for vendor-compatible payloads.
 * The historical SquashFS offset above is reported only. It is not required. */
#define MP716_IH_MAGIC 0x27051956u
#define MP716_IH_OS_LINUX 5u
#define MP716_IH_ARCH_MIPS 5u
#define MP716_IH_TYPE_KERNEL 2u
#define MP716_IH_COMP_LZMA 3u
#define MP716_SQUASHFS_MAGIC 0x73717368u
#define MP716_SQUASHFS_MAJOR 4u
#define MP716_SQUASHFS_XZ 4u

#endif /* MP716_FORMAT_H */
