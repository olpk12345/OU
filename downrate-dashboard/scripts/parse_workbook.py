from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime, time
from pathlib import Path

from openpyxl import load_workbook


REQUIRED_HEADERS = [
    "出单员",
    "退回审核意见",
    "提核退回标志",
    "出单时间",
    "保单号",
    "投保单号",
]
OPERATOR_PATTERN = re.compile(r"([\u3400-\u9fff·]{2,12})$")


def text_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat()
    return str(value)


def parse_record_date(value: object) -> tuple[str | None, int | None, int | None]:
    if value is None or text_value(value).strip() == "":
        return None, None, None
    if isinstance(value, datetime):
        return value.date().isoformat(), value.year, value.month
    if isinstance(value, date):
        return value.isoformat(), value.year, value.month

    value_text = text_value(value).strip()
    match = re.match(r"^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", value_text)
    if not match:
        return None, None, None
    year, month, day = (int(part) for part in match.groups())
    try:
        parsed = date(year, month, day)
    except ValueError:
        return None, None, None
    return parsed.isoformat(), parsed.year, parsed.month


def operator_name(value: str) -> str:
    normalized = value.strip()
    for prefix in ("客户经理", "业务员", "出单员", "操作员"):
        if normalized.startswith(prefix) and len(normalized) > len(prefix):
            normalized = normalized[len(prefix):]
            break
    match = OPERATOR_PATTERN.search(normalized)
    return match.group(1) if match else ""


def row_hash(values: dict[str, str]) -> str:
    canonical_values = {header: values[header] for header in sorted(values)}
    payload = json.dumps(canonical_values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_workbook(source: Path) -> dict[str, object]:
    workbook = load_workbook(source, read_only=True, data_only=True)
    try:
        sheet = workbook.active
        rows = sheet.iter_rows(values_only=True)
        header_values = next((list(row) for row in rows if any(value is not None for value in row)), [])
        headers = [text_value(value).strip() for value in header_values]
        missing_headers = [header for header in REQUIRED_HEADERS if header not in headers]
        if missing_headers:
            return {
                "sourceFile": str(source),
                "headers": headers,
                "rows": [],
                "periods": [],
                "errors": [{
                    "code": "missing_headers",
                    "headers": missing_headers,
                    "message": f"缺少必需表头: {'、'.join(missing_headers)}",
                }],
            }

        header_index = {header: index for index, header in enumerate(headers)}
        parsed_rows: list[dict[str, object]] = []
        errors: list[dict[str, object]] = []
        periods: set[tuple[int, int]] = set()
        for source_row, raw_row in enumerate(rows, start=2):
            values = {
                header: text_value(raw_row[index] if index < len(raw_row) else None)
                for index, header in enumerate(headers)
            }
            if not any(values.values()):
                continue

            record_date, year, month = parse_record_date(raw_row[header_index["出单时间"]])
            if record_date is None:
                errors.append({
                    "code": "missing_date",
                    "sourceRow": source_row,
                    "header": "出单时间",
                    "message": f"第 {source_row} 行缺少有效的出单时间",
                })
            else:
                periods.add((year, month))

            operator_raw = values["出单员"]
            policy_no = values["保单号"].strip()
            proposal_no = values["投保单号"].strip()
            normalized = {
                "sourceRow": source_row,
                "values": values,
                "operatorRaw": operator_raw,
                "operatorName": operator_name(operator_raw),
                "opinion": values["退回审核意见"],
                "returnFlag": values["提核退回标志"],
                "recordDate": record_date,
                "year": year,
                "month": month,
                "rowKey": policy_no or proposal_no,
            }
            normalized["rowHash"] = row_hash(values)
            parsed_rows.append(normalized)

        return {
            "sourceFile": str(source),
            "headers": headers,
            "rows": parsed_rows,
            "periods": [
                {"year": year, "month": month}
                for year, month in sorted(periods)
            ],
            "errors": errors,
        }
    finally:
        workbook.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = parse_workbook(args.input.resolve())
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
