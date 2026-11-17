"""Create the disposable Ed25519 key pair shared by a CI build and its test package."""

import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


if __name__ == "__main__":
    output = Path("build/ci-release")
    output.mkdir(parents=True, exist_ok=True)
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
