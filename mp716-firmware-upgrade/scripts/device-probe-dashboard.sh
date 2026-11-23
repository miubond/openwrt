#!/bin/sh
# SSH 到设备后：sh /tmp/device-probe-dashboard.sh
set -e
export REQUEST_METHOD=GET
export REQUEST_URI=/cgi-bin/mp716/home/dashboard
export PATH_INFO=/cgi-bin/mp716/home/dashboard
export HTTP_AUTHORIZATION="Bearer ${1:-00000000000000000000000000000000}"
export SCRIPT_NAME=/cgi-bin/mp716
/usr/bin/ucode /usr/share/mp716/httpd.uc 2>/tmp/httpd-err.txt | head -c 500
echo
echo "--- stderr ---"
cat /tmp/httpd-err.txt 2>/dev/null | tail -20