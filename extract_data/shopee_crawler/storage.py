"""Luu du lieu: CSV + raw JSON + summary JSON, dat ten theo NGAY CAO.

Quy uoc ten file (trong csv_processed\\):
    <kind>_<YYYY-MM-DD>.csv           <- bang du lieu chinh
    <kind>_<YYYY-MM-DD>_raw.json      <- JSON day du
    <kind>_<YYYY-MM-DD>_summary.json  <- thong ke ngan

Ngay cao = ngay sua doi moi nhat cua cac file .html trong crawl_manually
(phản anh dung thoi diem ban bam Ctrl+S), fallback = ngay hom nay.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from . import config
from .parser import BASE_COLUMNS, EXTRA_COLUMNS

DATE_FMT = "%Y-%m-%d"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def today() -> str:
    return datetime.now().strftime(DATE_FMT)


def mtime_date(path: Path | str) -> str:
    """Ngay (YYYY-MM-DD) theo mtime cua file — dung thoi diem luu (Ctrl+S)."""
    return datetime.fromtimestamp(Path(path).stat().st_mtime).strftime(DATE_FMT)


def crawl_date(pages_dir: Path | str | None = None) -> str:
    """Ngay cao (YYYY-MM-DD): theo mtime moi nhat cua file .html da luu."""
    base = Path(pages_dir or config.PAGES_DIR)
    htmls = list(base.glob("*.html")) + list(base.glob("*.htm"))
    if htmls:
        newest = max(htmls, key=lambda p: p.stat().st_mtime)
        return mtime_date(newest)
    return today()


def list_page_dirs(
    pages_dir: Path | str | None = None,
) -> list[tuple[str, Path]]:
    """[(date, thu_muc)] cho cac thu muc con dat ten theo ngay trong crawl_manually."""
    base = Path(pages_dir or config.PAGES_DIR)
    if not base.exists():
        return []
    dirs = [
        (d.name, d)
        for d in base.iterdir()
        if d.is_dir() and DATE_RE.match(d.name)
    ]
    return sorted(dirs)


def _html_files(folder: Path) -> list[Path]:
    return sorted(list(folder.glob("*.html")) + list(folder.glob("*.htm")))


def iter_pages(
    pages_dir: Path | str | None = None,
) -> list[tuple[str, Path, list[Path]]]:
    """[(date, thu_muc_ngay, [file .html])], da gom theo NGAY CAO.

    - Uu tien cac thu muc con `YYYY-MM-DD` trong crawl_manually.
    - File .html nam roi o goc se duoc gom theo mtime vao nhom ngay cua no
      (thu muc dich base/<date> co the chua ton tai).
    """
    base = Path(pages_dir or config.PAGES_DIR)
    groups: dict[str, tuple[Path, list[Path]]] = {}
    if base.exists():
        for name, folder in list_page_dirs(base):
            files = _html_files(folder)
            if files:
                groups[name] = (folder, files)
        for loose in _html_files(base):
            date = mtime_date(loose)
            if date in groups:
                groups[date][1].append(loose)
            else:
                groups[date] = (base / date, [loose])
    return [(date, folder, files) for date, (folder, files) in sorted(groups.items())]


def newest_date(pages_dir: Path | str | None = None) -> str | None:
    """Ngay cao moi nhat (ten thu muc ngay lon nhat), None neu chua co du lieu."""
    dirs = list_page_dirs(pages_dir)
    if dirs:
        return dirs[-1][0]
    groups = iter_pages(pages_dir)
    return groups[-1][0] if groups else None


def ensure_dirs() -> None:
    for directory in (config.PAGES_DIR, config.IMAGES_DIR, config.PROCESSED_DIR):
        Path(directory).mkdir(parents=True, exist_ok=True)


def _processed_dir() -> Path:
    path = Path(config.PROCESSED_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_csv(records: list[dict], kind: str, date: str | None = None) -> Path:
    date = date or crawl_date()
    path = _processed_dir() / f"{kind}_{date}.csv"
    df = pd.DataFrame(records)
    ordered = [c for c in BASE_COLUMNS + EXTRA_COLUMNS if c in df.columns]
    remaining = [c for c in df.columns if c not in ordered]
    df = df[ordered + remaining]
    # utf-8-sig (co BOM) de Excel tren Windows hien dung tieng Viet
    df.to_csv(path, index=False, encoding="utf-8-sig")
    return path


def save_raw(records: list[dict], kind: str, date: str | None = None) -> Path:
    date = date or crawl_date()
    path = _processed_dir() / f"{kind}_{date}_raw.json"
    path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def save_summary(
    records: list[dict], kind: str, date: str | None = None, files_merged: int = 1
) -> Path:
    date = date or crawl_date()
    path = _processed_dir() / f"{kind}_{date}_summary.json"
    summary = {
        "rows": len(records),
        "files_merged": files_merged,
        "crawl_date": date,
        "created_at": datetime.now().isoformat(),
    }
    path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def records_from_file(path: Path | str) -> list[dict[str, Any]]:
    return json.loads(Path(path).read_text(encoding="utf-8"))
