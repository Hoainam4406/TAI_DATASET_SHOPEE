"""Tai ANH cua cac san pham boc tu trang Shopee da luu -> luu vao may.

Anh lay tu CDN anh cua Shopee (cf.shopee.vn / *.susercontent.com) — KHONG lien
quan tới anti-bot tai khoan.

Anh duoc luu THEO NGAY CAO:
    F:\\SHOPEE\\image\\<YYYY-MM-DD>\\{id}_main.jpg|png|webp

Mac dinh quet tat ca cac thu muc ngay trong crawl_manually va tai anh cho tung
ngay (giong parse_saved_pages / parse_saved_products).

Cach dung:
    python download_saved_images.py
    python download_saved_images.py "F:\\SHOPEE\\csv_processed\\shopee_listing_2026-10-14_raw.json"
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parse_saved_pages import PAGES_DIR, log, parse_file  # noqa: E402

from shopee_crawler import config  # noqa: E402
from shopee_crawler.images import download_images  # noqa: E402
from shopee_crawler.parser import normalize  # noqa: E402
from shopee_crawler.storage import iter_pages, newest_date, today  # noqa: E402

_DATE_IN_NAME = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _records_from_raw(path: str) -> list[dict]:
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("records") or data.get("products") or []
    return data


def _download(records: list[dict], date: str) -> dict:
    target = config.IMAGES_DIR / date
    log(f"[i] Ngay cao {date}: tai anh {len(records)} san pham vao {target} ...")
    stats = download_images(records, concurrency=4, date=date)
    log(f"[OK] ngay {date}: ok={stats['ok']}  skip={stats['skip']}  fail={stats['fail']}")
    return stats


def _from_raw_arg(path: str) -> int:
    records = _records_from_raw(path)
    if not records:
        log(f"[X] File {path} khong co san pham nao.")
        return 1
    m = _DATE_IN_NAME.search(os.path.basename(path))
    date = m.group(1) if m else (newest_date(PAGES_DIR) or today())
    log(f"[i] Doc tu file: {os.path.basename(path)} ({len(records)} SP)")
    _download(records, date)
    return 0


def main() -> int:
    if len(sys.argv) > 1:
        return _from_raw_arg(sys.argv[1])

    groups = iter_pages(PAGES_DIR)
    if not groups:
        log(f"[X] Khong co file .html nao trong {PAGES_DIR}")
        log("[X] Khong co san pham nao de tai anh.")
        return 1

    produced = False
    for date, _folder, files in groups:
        log(f"[i] Ngay {date}: boc {len(files)} file HTML de lay danh sach anh ...")
        cards: dict = {}
        for path in files:
            try:
                for entry in parse_file(path):
                    pid = entry["item_basic"]["itemid"]
                    cards.setdefault(pid, entry)
            except Exception as exc:  # noqa: BLE001
                log(f"      ! loi {os.path.basename(path)[:45]}: {str(exc)[:70]}")
        if not cards:
            continue
        records = [normalize(e, date) for e in cards.values()]
        _download(records, date)
        produced = True

    if not produced:
        log("[X] Khong co san pham nao de tai anh.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
