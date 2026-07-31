from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook


HEADERS = [
    "\u9000\u56de\u5ba1\u6838\u610f\u89c1",
    "\u51fa\u5355\u5458",
    "\u4fdd\u5355\u53f7",
    "\u6295\u4fdd\u5355\u53f7",
    "\u63d0\u6838\u9000\u56de\u6807\u5fd7",
    "\u51fa\u5355\u65f6\u95f4",
    "\u5907\u6ce8\u5217",
]


def build_workbook(output_path: Path, scenario: str) -> dict[str, object]:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "\u5bfc\u5165\u6570\u636e"
    headers = list(HEADERS)
    if scenario == "missing-header":
        headers.remove("\u51fa\u5355\u65f6\u95f4")
    sheet.append(headers)
    if scenario == "missing-header":
        sheet.append(["\u521d\u5ba1\u901a\u8fc7", "12345\u5f20\u4e09", "P-001", "TB-001", "N", "\u4fdd\u7559\u539f\u59cb\u5217"])
    else:
        sheet.append(["\u521d\u5ba1\u901a\u8fc7", "12345\u5f20\u4e09", "P-001", "TB-001", "N", datetime(2026, 2, 18, 10, 30), "\u4fdd\u7559\u539f\u59cb\u5217A"])
        sheet.append(["", "\u5de5\u53f767890\u674e\u56db", "", "TB-ONLY-1", "Y", "2026-02-19", "\u4fdd\u7559\u539f\u59cb\u5217B"])
        sheet.append(["\u5f85\u8865\u5145", "\u5ba2\u6237\u7ecf\u7406\u738b\u4e94", "P-002", "", "N", datetime(2026, 2, 20), "\u4fdd\u7559\u539f\u59cb\u5217C"])
        sheet.append(["\u5f85\u786e\u8ba4\u539f\u56e0", "24680", "", "", "Y", datetime(2026, 2, 21), ""])
    workbook.save(output_path)
    return {"path": str(output_path), "headers": headers, "scenario": scenario}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--scenario", choices=["default", "missing-header"], default="default")
    args = parser.parse_args()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    print(json.dumps(build_workbook(output_path, args.scenario), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
