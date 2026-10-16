"""Tai anh chinh (main image) cua tung san pham, chia theo NGAY CAO.

Duong dan: image\\<YYYY-MM-DD>\\{id}_main.jpg|png|webp
Ngay cao lay tu storage.crawl_date() (mtime moi nhat cua file .html da luu).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

from . import config

_KNOWN_EXTS = (".jpeg", ".jpg", ".png", ".webp", ".gif")


def _ext_from_url(url: str, default: str = ".jpg") -> str:
    lowered = url.lower()
    for ext in _KNOWN_EXTS:
        if lowered.endswith(ext) or f"{ext}?" in lowered:
            return ext
    return default


def download_one(url: str, dest: Path, timeout: float | None = None) -> str:
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"
    resp = requests.get(
        url,
        timeout=timeout or config.REQUEST_TIMEOUT,
        headers={"User-Agent": config.DEFAULT_HEADERS["User-Agent"]},
    )
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)
    return "ok"


def download_images(
    records: list[dict],
    images_dir: Path | str | None = None,
    concurrency: int | None = None,
    date: str | None = None,
) -> dict[str, int]:
    """Tai anh cua records vao <images_dir>/<date>/ .

    Neu date=None, tu lay ngay cao tu cac file .html da luu.
    """
    base = Path(images_dir or config.IMAGES_DIR)
    if date is None:
        from .storage import crawl_date

        date = crawl_date()
    target = base / date
    target.mkdir(parents=True, exist_ok=True)
    concurrency = concurrency or config.IMAGE_CONCURRENCY

    tasks: list[tuple[str, Path]] = []
    for record in records:
        pid = record.get("id")
        url = record.get("main_image_url")
        if not pid or not url:
            continue
        dest = target / f"{pid}_main{_ext_from_url(url)}"
        tasks.append((url, dest))

    results = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(download_one, url, dest): dest for url, dest in tasks}
        for future in as_completed(futures):
            try:
                results[future.result()] += 1
            except Exception:  # noqa: BLE001 - dem loi, khong dung chuong trinh
                results["fail"] += 1
    return results
