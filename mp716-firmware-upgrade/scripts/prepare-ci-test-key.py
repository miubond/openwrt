"""Prepare the Ed25519 public key shared by a CI build and its test package."""

import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


if __name__ == "__main__":
    output = Path("build/ci-release")
    output.mkdir(parents=True, exist_ok=True)
    configured_key = os.environ.get("MP716_CI_SIGNING_KEY")
    if configured_key:
        private_key = Path(configured_key)
        if not private_key.is_absolute() or private_key.resolve().is_relative_to(
            Path(__file__).resolve().parents[1]
        ):
            raise SystemExit("MP716_CI_SIGNING_KEY must be an absolute path outside the firmware repository")
        key = Ed25519PrivateKey.from_private_bytes(private_key.read_bytes())
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
