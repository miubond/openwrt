/* RFC 2131/2132 DHCPDISCOVER-only LAN probe. Never sends REQUEST/ACK/RELEASE,
 * changes an address, or invokes the normal DHCP client hook. */
#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE 1
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct offer {
  uint8_t ip[4], mac[6];
  int direct;
};
static uint16_t read16(const uint8_t *p) {
  return (uint16_t)((p[0] << 8) | p[1]);
}
static void write16(uint8_t *p, uint16_t n) {
  p[0] = (uint8_t)(n >> 8);
  p[1] = (uint8_t)n;
}
static uint16_t checksum(const uint8_t *p, size_t n) {
  uint32_t sum = 0;
  while (n > 1) {
    sum += read16(p);
    p += 2;
    n -= 2;
  }
  if (n)
    sum += (uint32_t)*p << 8;
  while (sum >> 16)
    sum = (sum & 65535) + (sum >> 16);
  return (uint16_t)~sum;
}
static int address(const uint8_t *p) {
  return p[0] > 0 && p[0] != 127 && p[0] < 224 &&
         memcmp(p, "\xff\xff\xff\xff", 4) != 0;
}
static size_t discover(uint8_t *frame, const uint8_t mac[6],
                       const uint8_t xid[4]) {
  uint8_t *ip = frame + 14, *udp = ip + 20, *b = udp + 8, *o = b + 240;
  memset(frame, 0, 342);
  memset(frame, 255, 6);
  memcpy(frame + 6, mac, 6);
  write16(frame + 12, 0x0800);
  ip[0] = 0x45;
  write16(ip + 2, 328);
  memcpy(ip + 4, xid + 2, 2);
  ip[8] = 64;
  ip[9] = 17;
  memset(ip + 16, 255, 4);
  write16(ip + 10, checksum(ip, 20));
  write16(udp, 68);
  write16(udp + 2, 67);
  write16(udp + 4, 308);
  b[0] = 1;
  b[1] = 1;
  b[2] = 6;
  memcpy(b + 4, xid, 4);
  write16(b + 10, 0x8000);
  memcpy(b + 28, mac, 6);
  memcpy(b + 236, "\x63\x82\x53\x63", 4);
  *o++ = 53;
  *o++ = 1;
  *o++ = 1; /* Only DHCPDISCOVER. */
  *o++ = 61;
  *o++ = 7;
  *o++ = 1;
  memcpy(o, mac, 6);
  o += 6;
  *o++ = 55;
  *o++ = 3;
  *o++ = 1;
  *o++ = 3;
  *o++ = 6;
  *o = 255;
  return 342;
}
static int parse_offer(const uint8_t *frame, size_t n, const uint8_t mac[6],
                       const uint8_t xid[4], struct offer *out) {
  size_t at = 14, ihl, total, udplen, end;
  unsigned tags = 0;
  uint16_t proto;
  const uint8_t *ip, *udp, *b, *server = NULL;
  int type = 0, ended = 0;
  if (n < 14)
    return 0;
  proto = read16(frame + 12);
  while ((proto == 0x8100 || proto == 0x88a8) && tags++ < 2) {
    if (n < at + 4)
      return 0;
    proto = read16(frame + at + 2);
    at += 4;
  }
  if (proto != 0x0800 || n < at + 20)
    return 0;
  ip = frame + at;
  ihl = (ip[0] & 15u) * 4u;
  total = read16(ip + 2);
  if ((ip[0] >> 4) != 4 || ihl < 20 || n < at + ihl || total < ihl + 8 + 240 ||
      total > n - at || ip[9] != 17 || (read16(ip + 6) & 0x3fff) ||
      checksum(ip, ihl) != 0)
    return 0;
  udp = ip + ihl;
  udplen = read16(udp + 4);
  if (read16(udp) != 67 || read16(udp + 2) != 68 || udplen < 248 ||
      udplen > total - ihl)
    return 0;
  b = udp + 8;
  end = udplen - 8;
  if (b[0] != 2 || b[1] != 1 || b[2] != 6 || memcmp(b + 4, xid, 4) ||
      memcmp(b + 28, mac, 6) || memcmp(b + 236, "\x63\x82\x53\x63", 4) ||
      !address(b + 16))
    return 0;
  for (at = 240; at < end;) {
    unsigned option = b[at++], len;
    if (option == 0)
      continue;
    if (option == 255) {
      ended = 1;
      break;
    }
    if (at >= end)
      return 0;
    len = b[at++];
    if (len > end - at)
      return 0;
    if (option == 53) {
      if (len != 1 || type)
        return 0;
      type = b[at];
    }
    if (option == 54) {
      if (len != 4 || server)
        return 0;
      server = b + at;
    }
    at += len;
  }
  if (!ended || type != 2 || !server || !address(server))
    return 0;
  memcpy(out->ip, server, 4);
  out->direct = memcmp(ip + 12, server, 4) == 0;
  if (out->direct)
    memcpy(out->mac, frame + 6, 6);
  else
    memset(out->mac, 0, 6);
  return 1;
}

#ifndef MP716_DHCP_CODEC_TEST
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/if_ether.h>
#include <linux/if_packet.h>
#include <net/if.h>
#include <poll.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping;
static void stop(int sig) {
  (void)sig;
  stopping = 1;
}
static int64_t milliseconds(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t))
    return -1;
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
int main(int argc, char **argv) {
  int fd = -1, random = -1, result = 1, sent = 0;
  unsigned index;
  uint8_t mac[6], xid[4], frame[342], input[2048];
  struct ifreq req;
  struct sockaddr_ll link;
  int64_t started, now;
  if (argc != 2 || strcmp(argv[1], "lo") == 0 || strlen(argv[1]) >= IFNAMSIZ) {
    fputs("usage: mp716-dhcp-discover LAN_DEVICE\n", stderr);
    return 2;
  }
  for (size_t i = 0; argv[1][i]; i++)
    if (!((argv[1][i] >= 'A' && argv[1][i] <= 'Z') ||
          (argv[1][i] >= 'a' && argv[1][i] <= 'z') ||
          (argv[1][i] >= '0' && argv[1][i] <= '9') ||
          strchr("_.-", argv[1][i])))
      return 2;
  index = if_nametoindex(argv[1]);
  if (!index) {
    perror("LAN device");
    return 1;
  }
  random = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (random < 0 || read(random, xid, 4) != 4) {
    perror("random");
    goto done;
  }
  close(random);
  random = -1;
  fd = socket(AF_PACKET, SOCK_RAW | SOCK_CLOEXEC, htons(ETH_P_IP));
  if (fd < 0) {
    perror("packet socket");
    goto done;
  }
  memset(&req, 0, sizeof(req));
  memcpy(req.ifr_name, argv[1], strlen(argv[1]));
  if (ioctl(fd, SIOCGIFHWADDR, &req)) {
    perror("LAN MAC");
    goto done;
  }
  memcpy(mac, req.ifr_hwaddr.sa_data, 6);
  memset(&link, 0, sizeof(link));
  link.sll_family = AF_PACKET;
  link.sll_ifindex = (int)index;
  link.sll_protocol = htons(ETH_P_IP);
  link.sll_halen = 6;
  memset(link.sll_addr, 255, 6);
  if (bind(fd, (struct sockaddr *)&link, sizeof(link))) {
    perror("LAN bind");
    goto done;
  }
  signal(SIGTERM, stop);
  signal(SIGINT, stop);
  setvbuf(stdout, NULL, _IOLBF, 0);
  discover(frame, mac, xid);
  started = milliseconds();
  if (started < 0)
    goto done;
  while (!stopping && (now = milliseconds()) >= started &&
         now - started < 6500) {
    struct pollfd p = {fd, POLLIN, 0};
    struct offer found;
    if (sent < 3 && now - started >= sent * 2000) {
      if (sendto(fd, frame, sizeof(frame), 0, (struct sockaddr *)&link,
                 sizeof(link)) != (ssize_t)sizeof(frame)) {
        perror("DHCPDISCOVER");
        goto done;
      }
      sent++;
    }
    if (poll(&p, 1, 100) < 0) {
      if (errno == EINTR)
        continue;
      perror("poll");
      goto done;
    }
    if (p.revents & POLLIN) {
      ssize_t length = recv(fd, input, sizeof(input), 0);
      if (length > 0 && parse_offer(input, (size_t)length, mac, xid, &found)) {
        printf("DHCP_SERVER %u.%u.%u.%u", found.ip[0], found.ip[1], found.ip[2],
               found.ip[3]);
        if (found.direct)
          printf(" %02x:%02x:%02x:%02x:%02x:%02x", found.mac[0], found.mac[1],
                 found.mac[2], found.mac[3], found.mac[4], found.mac[5]);
        putchar('\n');
      }
    }
  }
  result = stopping ? 143 : 0;
done:
  if (fd >= 0)
    close(fd);
  if (random >= 0)
    close(random);
  return result;
}
#endif
