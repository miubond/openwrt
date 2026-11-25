"""Write the Ed25519 key pair shared by a CI build and its upgrade package.

MP716_SIGNING_KEY (base64 raw 32-byte seed) keeps the key stable across builds so a
device can verify the next release; without it a disposable key is generated.
"""

import base64
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


if __name__ == "__main__":
    output = Path("build/ci-release")
    output.mkdir(parents=True, exist_ok=True)
    seed_b64 = os.environ.get("MP716_SIGNING_KEY", "").strip()
    if seed_b64:
        seed_raw = base64.b64decode(seed_b64, validate=True)
        if len(seed_raw) != 32:
            raise SystemExit("MP716_SIGNING_KEY must be a base64 32-byte Ed25519 seed")
        key = Ed25519PrivateKey.from_private_bytes(seed_raw)
    else:
        key = Ed25519PrivateKey.generate()
    private_key = output / "ci-test.priv"
    with os.fdopen(os.open(private_key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as seed:
        seed.write(key.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        ))
    (output / "upgrade.pub").write_bytes(key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))
