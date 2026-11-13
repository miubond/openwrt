/* Real SPI NOR access is intentionally absent.
 * Linking this file is not part of the host or device build.
 * Hardware acceptance has not authorized an erase or a program operation.
 */

#include "error_codes.h"

int mp716_mtd_real_backend_linked(void)
{
	return MP716_ERR_FLASH_DISABLED;
}
