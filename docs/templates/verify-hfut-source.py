"""Read-only check of the public 2018 form template. No accounts or local data read."""
import hashlib
import io
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

URL = "https://gsu.hfut.edu.cn/_upload/article/files/10/cd/d04075af4e94ab2e878a12586ef6/3cd06e40-2182-4677-beb7-5b024f24418e.xlsx"
EXPECTED_SHA256 = "5102bd275a962545252bf5f8b4398ba2e731a48ef6c21bcfd9e1d3539e2dab1f"
NAMESPACE = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with urllib.request.urlopen(URL, timeout=30) as response:
        content = response.read(2_000_001)
    if len(content) > 2_000_000:
        raise ValueError("Source exceeds the expected blank-template download size")
    digest = hashlib.sha256(content).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError(f"Source changed: expected {EXPECTED_SHA256}, received {digest}. Review a new contract version.")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared = ["".join(item.itertext()) for item in strings]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        labels = {"A1", "H1", "A2", "D2", "A3", "E3", "A4", "E4", "A5", "B5", "C5", "D5", "E5", "F5", "H7", "D6", "E6", "F4"}
        cells = {}
        for cell in sheet.findall(".//s:c", NAMESPACE):
            value = cell.find("s:v", NAMESPACE)
            formula = cell.find("s:f", NAMESPACE)
            if value is None and formula is None:
                continue
            text = value.text if value is not None else None
            if cell.get("t") == "s" and text is not None:
                text = shared[int(text)]
            if formula is not None and formula.text is not None:
                cells[cell.get("r")] = {"formula": formula.text, "attributes": formula.attrib}
            elif cell.get("r") in labels:
                cells[cell.get("r")] = text
        print(json.dumps({"sha256": digest, "bytes": len(content), "sheets": [s.get("name") for s in workbook.findall("s:sheets/s:sheet", NAMESPACE)], "cells": cells, "mergedRanges": [cell.get("ref") for cell in sheet.findall("s:mergeCells/s:mergeCell", NAMESPACE)]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
