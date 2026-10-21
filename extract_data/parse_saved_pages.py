"""Boc du lieu TRANG DANH SACH (listing) tu cac file .html da luu thu cong.

HOAN TOAN OFFLINE: chi doc file HTML da luu tren may, KHONG gui request nao
toi Shopee. Regex truc tiep tren HTML (khong can trinh duyet).

Dau vao : F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD>\\*.html   (luu bang Ctrl+S)
Dau ra  : F:\\SHOPEE\\csv_processed\\shopee_listing_<YYYY-MM-DD>.csv (+ raw/summary)
          -> moi NGAY CAO ra 1 file CSV rieng.

Cach dung:
    python parse_saved_pages.py
"""

import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.parser import normalize  # noqa: E402
from shopee_crawler.storage import (  # noqa: E402
    ensure_dirs,
    iter_pages,
    save_csv,
    save_raw,
    save_summary,
)

PAGES_DIR = str(config.PAGES_DIR)
PREFIX = "shopee_listing"

_ANCHOR = re.compile(
    r'<a[^>]+href="https://shopee\.vn/[^"]*?-i\.(\d+)\.(\d+)[^"]*?"', re.I
)

# Trang CHI TIET san pham (PDP) co ld+json "@type":"Product".
# Trang danh sach (listing) co "@type":"ItemList". -> bo qua PDP khi boc listing,
# de khong lan cac the "san pham tuong tu" o cuoi PDP vao CSV listing.
_PDP_LD = re.compile(r'"@type"\s*:\s*"Product"')


def _money(text: str | None) -> int | None:
    if not text:
        return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) * 100000 if digits else None


def _sold(text: str | None):
    if not text:
        return ""
    m = re.search(r"([\d.]+)", text.replace(",", ""))
    return int(m.group(1).replace(".", "")) if m else ""


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def parse_file(path: str) -> list[dict]:
    data = open(path, encoding="utf-8", errors="ignore").read()
    matches = list(_ANCHOR.finditer(data))
    out: list[dict] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(data)
        chunk = data[m.start():end]
        shopid, itemid = m.group(1), m.group(2)

        nm = re.search(r'aria-label="View product:\s*(.*?)"', chunk)
        if not nm:
            nm = re.search(r'alt="(.*?)"', chunk)
        name = html.unescape(nm.group(1)).strip() if nm else ""

        im = re.search(r"/file/([a-zA-Z0-9_-]+)", chunk)
        image = im.group(1) if im else ""

        pm = re.search(r'text-base/5 font-medium">([\d.,]+)</span>', chunk)
        price = _money(pm.group(1)) if pm else None

        dm = re.search(r'aria-label="-(\d+)%"', chunk) or re.search(
            r">-(\d+)%<", chunk
        )
        disc = int(dm.group(1)) if dm else 0
        original = (
            round(price / (1 - disc / 100)) if price and 0 < disc < 100 else (price or 0)
        )

        sm = re.search(r"Đã bán\s*([\d.,]+)", chunk)
        sold = _sold(sm.group(1)) if sm else ""

        out.append(
            {
                "item_basic": {
                    "itemid": int(itemid),
                    "shopid": int(shopid),
                    "name": name,
                    "image": image,
                    "price": price,
                    "price_before_discount": original,
                    "sold": sold,
                }
            }
        )
    return out


def main() -> int:
    groups = iter_pages(PAGES_DIR)
    if not groups:
        log(f"[X] Khong co file .html nao trong {PAGES_DIR}")
        return 1

    ensure_dirs()
    produced = False
    for date, _folder, files in groups:
        log(f"[i] Ngay {date}: boc {len(files)} file HTML ...")
        cards: dict = {}
        for path in files:
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except Exception as exc:  # noqa: BLE001
                log(f"      ! loi {os.path.basename(path)[:45]}: {str(exc)[:70]}")
                continue
            if _PDP_LD.search(text):
                log(f"      bo qua PDP: {os.path.basename(path)[:45]}")
                continue
            try:
                found = parse_file(path)
            except Exception as exc:  # noqa: BLE001
                log(f"      ! loi {os.path.basename(path)[:45]}: {str(exc)[:70]}")
                continue
            new = 0
            for entry in found:
                pid = entry["item_basic"]["itemid"]
                if pid not in cards:
                    cards[pid] = entry
                    new += 1
            log(f"      {os.path.basename(path)[:45]}: +{new} (tong {len(cards)})")

        if not cards:
            log(f"      (ngay {date}: khong trich duoc san pham nao)")
            continue

        records = [normalize(e, date) for e in cards.values()]
        csv_path = save_csv(records, PREFIX, date)
        save_raw(records, PREFIX, date)
        save_summary(records, PREFIX, date, files_merged=len(files))
        log(f"[OK] ngay {date}: {len(records)} san pham -> {csv_path}")
        produced = True

    if not produced:
        log("[X] Khong trich duoc san pham nao.")
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
