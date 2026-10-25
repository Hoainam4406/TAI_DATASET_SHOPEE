"""Ham dung chung cho du lieu cao chung — PHAI khop voi chrome_extension/lib/registry.js.

keyword_id = slug khong dau + 4 ky tu hash FNV-1a (tren keyword da chuan hoa, co dau):
    "tai nghe không dây" -> "tai-nghe-khong-day-xxxx"
Du lieu cua 1 keyword trong 1 ngay: data/<keyword_id>/<YYYY-MM-DD>.csv
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata

REGISTRY_PATH = "keywords.csv"
REGISTRY_COLUMNS = ["keyword_id", "keyword", "group", "status", "claimed_at", "done_at", "rows"]


def normalize_keyword(text: str) -> str:
    """Viet thuong, NFC, gop khoang trang."""
    s = unicodedata.normalize("NFC", str(text or "")).strip()
    return re.sub(r"\s+", " ", s).lower()


def _fnv1a32(text: str) -> int:
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def keyword_id(text: str) -> str:
    norm = normalize_keyword(text)
    slug = unicodedata.normalize("NFD", norm)
    slug = re.sub(r"[̀-ͯ]", "", slug).replace("đ", "d")
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")[:40].rstrip("-") or "kw"
    return f"{slug}-{_fnv1a32(norm):08x}"[: len(slug) + 5]


def read_registry(text: str | None) -> list[dict]:
    if not text:
        return []
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    out = []
    for r in rows:
        row = {c: (r.get(c) or "") for c in REGISTRY_COLUMNS}
        if not row["keyword_id"] and row["keyword"]:
            row["keyword_id"] = keyword_id(row["keyword"])
        row["status"] = row["status"] or "todo"
        out.append(row)
    return out


def write_registry(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=REGISTRY_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in REGISTRY_COLUMNS})
    return buf.getvalue()
