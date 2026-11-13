# Third-party cryptography

- `device/third_party/monocypher/` is Monocypher 4.0.3 (`crypto_ed25519_check`), dual-licensed BSD-2-Clause OR CC0-1.0. The license text is in the downloaded headers. The 2020 Cure53 audit covered the 3.1 line, not this later release.
- `device/third_party/sha256/` is Brad Conte's SHA-256 implementation. The upstream crypto-algorithms repository states that the code is released to the public domain. The original file headers are unchanged.

Neither file is a cipher written for this project. The upgrade code only calls the published functions.
