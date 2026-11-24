#!/bin/sh
# 把 CGI 网关与 admin-tick 预编译为字节码：每请求省去约 0.9s 的模块编译（MT7628 实测）。
# 输出在 tmpfs（overlay 空间不足）；开机由 mp716-admin 生成，热更后由部署脚本重建。
# 修改任何 /usr/share/mp716/*.uc 后必须重新执行；编译失败则删除字节码，回退到源码执行。
S=/usr/share/mp716
D=/tmp/mp716-ucb
mkdir -p "$D"
rc=0
for n in httpd admin-tick; do
	if /usr/bin/ucode -c -s -o "$D/$n.ucb.tmp" "$S/$n.uc" 2>/dev/null; then
		mv -f "$D/$n.ucb.tmp" "$D/$n.ucb"
	else
		rm -f "$D/$n.ucb.tmp" "$D/$n.ucb"
		echo "mp716-ucode-compile: $n.uc failed, using source" >&2
		rc=1
	fi
done
exit $rc
