#define MP716_DHCP_CODEC_TEST 1
#include "../../integration/ram-web/dhcp-discover.c"
#include <assert.h>

static void ip_checksum(uint8_t *p) {
  p[24] = p[25] = 0;
  write16(p + 24, checksum(p + 14, 20));
}
int main(void) {
  const uint8_t client[6] = {2, 0, 0, 0, 0, 1},
                server[6] = {2, 0x11, 0x22, 0x33, 0x44, 0x55},
                xid[4] = {0xab, 0xcd, 0xef, 0x12};
  const uint8_t server_ip[4] = {192, 168, 199, 1};
  uint8_t p[342], bad[342], *b = p + 42;
  struct offer found;
  size_t n = discover(p, client, xid);
  int passed = 0;
  assert(n == sizeof(p) && checksum(p + 14, 20) == 0 && p[284] == 1);
  passed++;
  assert(!parse_offer(p, n, client, xid, &found));
  passed++;
  memcpy(p + 6, server, 6);
  memcpy(p + 26, server_ip, 4);
  write16(p + 34, 67);
  write16(p + 36, 68);
  b[0] = 2;
  memcpy(b + 16, "\xc0\xa8\xc7\x14", 4);
  memset(b + 240, 0, 60);
  b[240] = 53;
  b[241] = 1;
  b[242] = 2;
  b[243] = 54;
  b[244] = 4;
  memcpy(b + 245, server_ip, 4);
  b[249] = 255;
  ip_checksum(p);
  assert(parse_offer(p, n, client, xid, &found) && found.direct &&
         memcmp(found.ip, server_ip, 4) == 0 &&
         memcmp(found.mac, server, 6) == 0);
  passed++;
  for (size_t cut = 0; cut < n; cut++)
    assert(!parse_offer(p, cut, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[46] ^= 1;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[70] ^= 1;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[42] = 1;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[284] = 5;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[285] = 55;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[286] = 100;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[285] = 53;
  bad[286] = 1;
  bad[287] = 2;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  write16(bad + 36, 67);
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  write16(bad + 20, 0x2000);
  ip_checksum(bad);
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[24] ^= 1;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  memset(bad + 58, 0, 4);
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[26] = 10;
  ip_checksum(bad);
  assert(parse_offer(bad, n, client, xid, &found) && !found.direct &&
         memcmp(found.mac, "\0\0\0\0\0\0", 6) == 0);
  passed++;
  memcpy(bad, p, n);
  bad[42 + 236] = 0;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  memcpy(bad, p, n);
  bad[42 + 245] = 224;
  assert(!parse_offer(bad, n, client, xid, &found));
  passed++;
  printf("{\"packet_cases\":%d,\"fixture_only\":true,\"network_io\":false}\n",
         passed);
  return 0;
}
