import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("check_wifi_device_tree", ROOT / "scripts/check-test-dts.py")
checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checks)


BOARD = """
/ {
    compatible = "yunxm,mp716";
    aliases {
        serial0 = "/palmbus@10000000/uart0@c00";
    };
    chosen {
        bootargs = "console=ttyS0,57600";
    };
    spi@b00 {
        status = "okay";
        flash@0 {
            partitions {
                partition@0 {
                    label = "u-boot";
                    reg = <0x0 0x30000>;
                    read-only;
                };
                partition@30000 {
                    label = "config";
                    reg = <0x30000 0x10000>;
                    read-only;
                };
                partition@40000 {
                    label = "factory";
                    reg = <0x40000 0x10000>;
                    read-only;
                    nvmem-layout {
                        compatible = "fixed-layout";
                        eeprom@0 {
                            reg = <0x0 0x400>;
                            phandle = <0x15>;
                        };
                    };
                };
                partition@50000 {
                    label = "firmware";
                    reg = <0x50000 0x7b0000>;
                    read-only;
                };
            };
        };
    };
    ethernet@10100000 {
        status = "okay";
    };
    esw@10110000 {
        status = "okay";
    };
    wmac@10300000 {
        status = "okay";
        nvmem-cells = <0x15>;
        nvmem-cell-names = "eeprom";
    };
    gpio@600 {
        status = "disabled";
    };
    uart0@c00 {
        status = "okay";
    };
};
"""


class WifiDeviceTreeTests(unittest.TestCase):
    def test_radio_can_read_factory_with_all_ram_partitions_read_only(self):
        checks.verify_device_tree(BOARD, candidate=False)

    def test_ram_requires_read_only_firmware_even_with_working_eeprom(self):
        board = BOARD.replace('reg = <0x50000 0x7b0000>;\n                    read-only;',
                              'reg = <0x50000 0x7b0000>;')
        with self.assertRaisesRegex(ValueError, "read-only firmware"):
            checks.verify_device_tree(board, candidate=False)
        checks.verify_device_tree(board, candidate=True)

    def test_radio_rejects_a_different_eeprom_reference(self):
        board = BOARD.replace("nvmem-cells = <0x15>", "nvmem-cells = <0x16>")
        with self.assertRaisesRegex(ValueError, "reference the Factory EEPROM"):
            checks.verify_device_tree(board, candidate=False)

    def test_radio_rejects_a_truncated_factory_cell(self):
        board = BOARD.replace("reg = <0x0 0x400>", "reg = <0x0 0x200>")
        with self.assertRaisesRegex(ValueError, "1024-byte Factory EEPROM"):
            checks.verify_device_tree(board, candidate=False)
