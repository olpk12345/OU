from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook


DEFAULT_HEADERS = [
    "退回审核意见",
    "出单员",
    "保单号",
    "投保单号",
    "提核退回标志",
    "出单时间",
    "备注列",
]


def build_workbook(output_path: Path, scenario: str) -> dict[str, object]:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "导入数据"

    headers = list(DEFAULT_HEADERS)
    if scenario == "missing-header":
      headers.remove("出单时间")

    sheet.append(headers)

    if scenario == "missing-header":
        sheet.append([
            "初审通过",
            "12345张三",
            "P-001",
            "TB-001",
            "N",
            "保留原始列A",
        ])
    else:
        sheet.append([
            "初审通过",
            "12345张三",
            "P-001",
            "TB-001",
            "N",
            datetime(2026, 2, 18, 10, 30, 0),
            "保留原始列A",
        ])
        sheet.append([
            "",
            "工号67890李四",
            "",
            "TB-ONLY-1",
            "Y",
            "2026-02-19",
            "保留原始列B",
        ])
        sheet.append([
            "待补充",
            "客户经理王五",
            "P-002",
            "",
            "N",
            datetime(2026, 2, 20),
            "保留原始列C",
        ])

        sheet.append([
            "",
            "24680",
            "",
            "",
            "Y",
            datetime(2026, 2, 21),
            "",
        ])

    workbook.save(output_path)
    return {
        "path": str(output_path),
        "headers": headers,
        "scenario": scenario,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", help="output workbook path")
    parser.add_argument(
        "--scenario",
        choices=["default", "missing-header"],
        default="default",
    )
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_workbook(output_path, args.scenario)
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
