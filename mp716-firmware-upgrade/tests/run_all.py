"""Load every test_*.py, including tests/fault-injection.

unittest discovery skips directories whose names are not Python identifiers,
so the fault-injection suite is loaded from its file path.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_suite() -> unittest.TestSuite:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for path in sorted((ROOT / "tests").rglob("test_*.py")):
        module_name = "mp716_" + path.parent.name.replace("-", "_") + "_" + path.stem
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        suite.addTests(loader.loadTestsFromModule(module))
    return suite


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(load_suite())
    raise SystemExit(0 if result.wasSuccessful() else 1)
