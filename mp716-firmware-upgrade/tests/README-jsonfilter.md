# Real jsonfilter host regressions

The VPN service tests need the actual OpenWrt jsonfilter lexer, parser and matcher.
The Linux bootstrap builds the pinned upstream code locally; it does not write
firmware or contact a device.

On Ubuntu, install the host dependencies and run from the repository directory:

```sh
sudo apt-get update
sudo apt-get install --yes gcc pkg-config libjson-c-dev
python3 scripts/build-jsonfilter-host.py
export JSONFILTER="$PWD/build/host-tools/jsonfilter"
export MP716_REQUIRE_JSONFILTER=1
python3 -m unittest discover -s tests/integration -p 'test_vpn_service.py' -v
```

`JSONFILTER` must point to a real executable. `MP716_REQUIRE_JSONFILTER=1` makes a
missing real tool fail the tests instead of skipping those cases. CI must set it
and must fail if the bootstrap fails. Other hosts may supply an existing real
binary through `JSONFILTER`; there is no Python replacement or fake parser.

The bootstrap requires Linux and Python 3.9 or newer. `--output` selects another
binary path and `--cc` selects a compiler executable. Its default output is
`build/host-tools/jsonfilter`; stdout contains only the resulting absolute path.

The script downloads these immutable upstream sources and checks their SHA-256
digests before using them:

- jsonpath `b9034210bd331749673416c6bf389cccd4e23610`, the jsonfilter source
  selected by this repository's OpenWrt `64900e756efa667774214f9c6b17c113222e01f7` pin.
- libubox `7dd127841e82eb1cfb61185da37dde7b9bd9ba6d`: `list.h`, `utils.h` and
  the complete Linux `utils.c`.

It compiles the bundled Lemon generator, generates `parser.c` from upstream
`parser.y`, and compiles upstream `main.c`, `ast.c`, `lexer.c`, `parser.c` and
`matcher.c` without source changes. JSON parsing comes from the system json-c
library; POSIX regular expressions come from the system C library.

Downloads stay in `build/host-tools/jsonfilter-cache`. A cached source with an
incorrect digest causes a clear failure; remove that specific file before
retrying. The adjacent `jsonfilter.provenance.json` records source hashes,
script hash, compiler identity and hash, system json-c version, build flags and
binary hash. A binary is reused only while these inputs and its hash match.

Ubuntu 24.04's json-c package is version 0.17. The separate local Windows host
build uses json-c 0.18 and a stdout initializer that preserves Linux LF output
and CR/LF data inside strings. These host checks verify the pinned jsonfilter
code's behavior with the recorded host dependencies; they do not prove that
the host runtime equals the target firmware or that VPN works on hardware.
