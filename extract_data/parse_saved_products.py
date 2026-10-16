"""Boc du lieu CHI TIET san pham tu cac trang PDP da luu (Ctrl+S) -> CSV/JSON.

HOAN TOAN OFFLINE. Nguon chinh:
  - <script type="application/ld+json"> @type=Product  (name, desc, url,
    productID, image, brand, offers.price, aggregateRating)
  - <script type="application/ld+json"> @type=BreadcrumbList (category)
  - JSON nhung trong HTML: "images":[hash...], "catid", "shop_name", "sold"
  - Khoi danh gia render san trong DOM (diem, so sao tung muc, comment):
    shopee-product-comment-list / data-cmtid=... (xem shopee_crawler/reviews.py)

Dau vao : F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD>\\*.html   (luu bang Ctrl+S)
Dau ra  : F:\\SHOPEE\\csv_processed\\shopee_detail_<YYYY-MM-DD>.csv (+ raw/summary)
          -> moi NGAY CAO ra 1 file CSV rieng.

Cach dung:
    python parse_saved_products.py
"""

import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.parser import normalize  # noqa: E402
from shopee_crawler.reviews import parse_reviews  # noqa: E402
from shopee_crawler.storage import (  # noqa: E402
    ensure_dirs,
    iter_pages,
    save_csv,
    save_raw,
    save_summary,
)

PAGES_DIR = str(config.PAGES_DIR)
PREFIX = "shopee_detail"

_LD = re.compile(
    r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', re.I | re.S
)
_URLID = re.compile(r"-i\.(\d+)\.(\d+)")
_IMG_ARRAY = re.compile(r'"images"\s*:\s*\[((?:"[^"]*")(?:\s*,\s*"[^"]*")*)\]')


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def _as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _ld_blocks(data: str) -> list:
    out = []
    for raw in _LD.findall(data):
        try:
            out.append(json.loads(raw.strip()))
        except Exception:  # noqa: BLE001
            continue
    return out


def _find_type(blocks: list, want: str) -> dict | None:
    for node in blocks:
        stack = node if isinstance(node, list) else [node]
        if isinstance(node, dict) and "@graph" in node:
            stack = node["@graph"]
        for n in stack:
            if not isinstance(n, dict):
                continue
            typ = n.get("@type")
            types = typ if isinstance(typ, list) else [typ]
            if any(str(t).lower() == want.lower() for t in types):
                return n
    return None


def _ld_price(value) -> int | None:
    """Gia trong ld+json la VND thuc (vd '282000.00') -> doi sang dang raw x100000."""
    if value is None:
        return None
    s = re.sub(r"[^\d.]", "", str(value))
    if not s:
        return None
    try:
        return int(float(s)) * 100000
    except ValueError:
        return None


def _find_images(data: str, main_hash: str) -> list[str]:
    best: list[str] = []
    for m in _IMG_ARRAY.finditer(data):
        hashes = re.findall(r'"([^"]+)"', m.group(1))
        if main_hash and main_hash in hashes:
            return hashes
        if len(hashes) > len(best):
            best = hashes
    return best


def _shopid_from_url(url: str) -> int | None:
    m = _URLID.search(url or "")
    return int(m.group(1)) if m else None


def parse_file(path: str) -> dict | None:
    data = open(path, encoding="utf-8", errors="ignore").read()
    blocks = _ld_blocks(data)
    prod = _find_type(blocks, "Product")
    if not prod:
        return None

    name = html.unescape(str(prod.get("name") or "")).strip()
    desc = html.unescape(str(prod.get("description") or "")).strip()
    url = prod.get("url") or ""

    price = _ld_price((_as_list(prod.get("offers")) or [{}])[0].get("price")
                      if prod.get("offers") else None)
    if price is None and isinstance(prod.get("offers"), dict):
        price = _ld_price(prod["offers"].get("price"))

    rating = reviews = None
    agg = prod.get("aggregateRating")
    if isinstance(agg, dict):
        try:
            rating = float(agg.get("ratingValue"))
        except (TypeError, ValueError):
            rating = None
        rc = agg.get("reviewCount") or agg.get("ratingCount")
        try:
            reviews = int(rc)
        except (TypeError, ValueError):
            reviews = None

    brand = prod.get("brand")
    brand = brand.get("name") if isinstance(brand, dict) else brand

    image_field = _as_list(prod.get("image"))
    main_hash = ""
    if image_field:
        first = image_field[0]
        first = first.get("url") if isinstance(first, dict) else first
        hm = re.search(r"/file/([a-zA-Z0-9_-]+)", str(first))
        main_hash = hm.group(1) if hm else str(first)

    images = _find_images(data, main_hash)
    if not images and main_hash:
        images = [main_hash]

    itemid = prod.get("productID") or prod.get("sku")
    itemid = int(itemid) if str(itemid).isdigit() else None
    if itemid is None:
        m = _URLID.search(url)
        itemid = int(m.group(2)) if m else None
    shopid = _shopid_from_url(url)

    catid = None
    bread = _find_type(blocks, "BreadcrumbList")
    if bread:
        ids = re.findall(r"cat\.(\d+)", json.dumps(bread))
        if ids:
            catid = int(ids[-1])
    if catid is None:
        cm = re.search(r'"catid"\s*:\s*(\d+)', data)
        catid = int(cm.group(1)) if cm else None

    sm = re.search(r'"shop_name"\s*:\s*"([^"]+)"', data)
    shop_name = html.unescape(sm.group(1)) if sm else ""

    sm2 = re.search(r'"(?:historical_sold|sold_count|sold)"\s*:\s*(\d+)', data)
    sold = int(sm2.group(1)) if sm2 else ""

    rv = parse_reviews(data)
    if rating is None and rv["rating_score"] != "":
        rating = rv["rating_score"]
    if not reviews and rv["rating_breakdown"]:
        reviews = sum(
            c for k, c in rv["rating_breakdown"].items() if "Sao" in k
        ) or None

    return {
        "item_basic": {
            "itemid": itemid,
            "shopid": shopid,
            "name": name,
            "image": main_hash,
            "images": images,
            "price": price,
            "description": desc,
            "rating_star": rating,
            "item_rating": {"rating_count": [reviews] if reviews else None},
            "catid": catid,
            "brand": brand,
            "shop_name": shop_name,
            "sold": sold,
            "rating_breakdown": rv["rating_breakdown"],
            "reviews": rv["reviews"],
        }
    }


def main() -> int:
    groups = iter_pages(PAGES_DIR)
    if not groups:
        log(f"[X] Khong co file .html nao trong {PAGES_DIR}")
        return 1

    ensure_dirs()
    produced = False
    for date, _folder, files in groups:
        log(f"[i] Ngay {date}: quet {len(files)} file, tim trang CHI TIET ...")
        cards: dict = {}
        for path in files:
            try:
                entry = parse_file(path)
            except Exception as exc:  # noqa: BLE001
                log(f"      ! loi {os.path.basename(path)[:40]}: {str(exc)[:60]}")
                continue
            if not entry or not entry["item_basic"].get("itemid"):
                continue
            pid = entry["item_basic"]["itemid"]
            if pid not in cards:
                cards[pid] = entry
                b = entry["item_basic"]
                nm = (b.get("name") or "")[:32].encode("ascii", "ignore").decode()
                nrev = len(b.get("reviews") or [])
                nx = len((b.get("description") or ""))
                log(
                    f"      + {pid} | {len(b.get('images') or [])} anh | "
                    f"desc {nx} | {nrev} comment | {nm}"
                )

        if not cards:
            log(f"      (ngay {date}: khong co trang chi tiet)")
            continue

        records = [normalize(e, date) for e in cards.values()]
        try:
            csv_path = save_csv(records, PREFIX, date)
        except PermissionError:
            log(
                f"      [X] Khong ghi duoc {PREFIX}_{date}.csv — file nang mo trong "
                f"Excel. Hay DONG file do di roi chay lai."
            )
            return 3
        save_raw(records, PREFIX, date)
        save_summary(records, PREFIX, date, files_merged=len(files))
        log(f"[OK] ngay {date}: {len(records)} san pham chi tiet -> {csv_path}")
        produced = True

    if not produced:
        log("[X] Khong tim thay trang chi tiet nao (thieu khoi ld+json Product).")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())