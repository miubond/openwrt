#ifndef _WIN32
/* -std=c99 hides POSIX declarations unless this is set before any libc header. */
#define _POSIX_C_SOURCE 200809L
#define _FILE_OFFSET_BITS 64
#endif
#define _CRT_SECURE_NO_WARNINGS

#include "mp716_port.h"

#include "error_codes.h"

#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#endif

int mp716_file_size(FILE *fp, uint64_t *out)
{
	if (!fp || !out)
		return MP716_ERR_IO;
#ifdef _WIN32
	if (_fseeki64(fp, 0, SEEK_END) != 0)
		return MP716_ERR_IO;
	__int64 n = _ftelli64(fp);
	if (n < 0 || _fseeki64(fp, 0, SEEK_SET) != 0)
		return MP716_ERR_IO;
	*out = (uint64_t)n;
#else
	if (fseeko(fp, 0, SEEK_END) != 0)
		return MP716_ERR_IO;
	off_t n = ftello(fp);
	if (n < 0 || fseeko(fp, 0, SEEK_SET) != 0)
		return MP716_ERR_IO;
	*out = (uint64_t)n;
#endif
	return MP716_OK;
}

int mp716_exclusive_create(const char *path)
{
	if (!path || !path[0])
		return MP716_ERR_IO;
#ifdef _WIN32
	HANDLE handle = CreateFileA(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
	if (handle == INVALID_HANDLE_VALUE) {
		DWORD err = GetLastError();
		if (err == ERROR_FILE_EXISTS || err == ERROR_ALREADY_EXISTS)
			return MP716_ERR_BUSY;
		return MP716_ERR_IO;
	}
	CloseHandle(handle);
	return MP716_OK;
#else
	int fd = open(path, O_CREAT | O_EXCL | O_WRONLY, 0600);
	if (fd < 0)
		return errno == EEXIST ? MP716_ERR_BUSY : MP716_ERR_IO;
	close(fd);
	return MP716_OK;
#endif
}

int mp716_remove_file(const char *path)
{
	if (!path || !path[0])
		return MP716_ERR_IO;
#ifdef _WIN32
	DeleteFileA(path);
#else
	unlink(path);
#endif
	return MP716_OK;
}

int mp716_replace_file(const char *tmp, const char *dst)
{
#ifdef _WIN32
	int attempt;
	for (attempt = 0; attempt < 5; attempt++) {
		DWORD error;
		if (MoveFileExA(tmp, dst, MOVEFILE_REPLACE_EXISTING))
			return MP716_OK;
		error = GetLastError();
		if (error != ERROR_SHARING_VIOLATION && error != ERROR_LOCK_VIOLATION && error != ERROR_ACCESS_DENIED)
			break;
		Sleep(20);
	}
	return MP716_ERR_IO;
#else
	if (rename(tmp, dst) != 0)
		return MP716_ERR_IO;
	return MP716_OK;
#endif
}

int mp716_join(char *out, size_t out_len, const char *dir, const char *name)
{
	size_t dir_len;
	int wrote;

	if (!out || !dir || !name || strchr(name, '/') || strchr(name, '\\') || strcmp(name, "..") == 0)
		return MP716_ERR_PATH;
	dir_len = strlen(dir);
	if (dir_len == 0 || dir_len + strlen(name) + 2 >= out_len)
		return MP716_ERR_PATH;
	if (dir[dir_len - 1] == '/' || dir[dir_len - 1] == '\\')
		wrote = snprintf(out, out_len, "%s%s", dir, name);
	else
		wrote = snprintf(out, out_len, "%s/%s", dir, name);
	if (wrote < 0 || (size_t)wrote >= out_len)
		return MP716_ERR_PATH;
	return MP716_OK;
}
