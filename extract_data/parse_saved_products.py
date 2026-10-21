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
          F:\\SHOPEE\\csv_processed\\shopee_comments_<YYYY-MM-DD>.csv
            -> MOI DONG = 1 comment rieng (star, comment, user, time...),
               vi cot `reviews` cua shopee_detail_... la JSON trong 1 o Excel.
          -> moi NGAY CAO ra 1 file CSV rieng.

Cach dung:
    python parse_saved_products.py
"""

import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.parser import normalize  # noqa: E402
from shopee_crawler.reviews import parse_reviews  # noqa: E402
from shopee_crawler.storage import (  # noqa: E402
    ensure_dirs,
    iter_pages,
    save_comments_csv,
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


def _review_key(r: dict):
    """Khoa khu trung cho 1 comment: uu tien cmtid, thieu thi dung van tay noi dung."""
    cid = r.get("cmtid")
    if cid is not None:
        return ("c", cid)
    return (
        "f",
        r.get("user"),
        r.get("time"),
        r.get("rating"),
        (r.get("comment") or "")[:120],
    )


def _merge_entry(base: dict, extra: dict) -> int:
    """Gop nhieu trang cung 1 san pham (vd moi muc sao 1 trang).

    KHONG BAO GIO lam mat comment:
      - khu trung theo cmtid; comment thieu cmtid thi theo van tay noi dung.
      - gop anh (union) va giu nhieu mo ta dai nhat.
    Tra ve so comment MOI them.
    """
    b = base["item_basic"]
    e = extra["item_basic"]

    by_key = {_review_key(r): r for r in (b.get("reviews") or [])}
    added = 0
    for r in e.get("reviews") or []:
        key = _review_key(r)
        if key not in by_key:
            by_key[key] = r
            added += 1
    b["reviews"] = list(by_key.values())

    bd = b.get("rating_breakdown") or {}
    for key, val in (e.get("rating_breakdown") or {}).items():
        cur = bd.get(key)
        if cur is None or (isinstance(val, int) and isinstance(cur, int) and val > cur):
            bd[key] = val
    b["rating_breakdown"] = bd

    for key in ("rating_star", "sold", "catid", "brand", "shop_name"):
        if not b.get(key) and e.get(key):
            b[key] = e[key]
    if len(e.get("description") or "") > len(b.get("description") or ""):
        b["description"] = e["description"]

    merged_imgs = list(dict.fromkeys((b.get("images") or []) + (e.get("images") or [])))
    if merged_imgs:
        b["images"] = merged_imgs
    return added


def _sold_count(text: str) -> int | str:
    """Doi chuoi sold cua Shopee ('123', '1k+', '1,6tr') thanh so nguyen."""
    s = (text or "").strip().lower().replace(" ", "").rstrip("+")
    mult = 1
    if s.endswith("tr"):
        mult, s = 1_000_000, s[:-2]
    elif s.endswith("k"):
        mult, s = 1000, s[:-1]
    s = s.replace(",", ".")
    try:
        return int(round(float(s) * mult))
    except ValueError:
        return ""


def _bff_fields(data: str, itemid: int) -> tuple[str, str]:
    """shop_location + ctime tu block JSON PDP_BFF_DATA cua SAN PHAM NAY.

    Trong trang Ctrl+S, `"item_id":<pid>` dau tien nam trong cachedMap
    -> 6000 chu sau do chua shop_location va ctime (cac lan sau la model/variant).
    Tra (shop_location, ctime 'YYYY-MM-DD HH:MM:SS' theo gio VN).
    """
    m = re.search(r'"item_id"\s*:\s*%d\b' % itemid, data)
    if not m:
        return "", ""
    win = data[m.start():m.start() + 6000]
    shop_location = ""
    lm = re.search(r'"shop_location"\s*:\s*"([^"]*)"', win)
    if lm:
        shop_location = html.unescape(lm.group(1)).strip()
    ctime = ""
    cm = re.search(r'"ctime"\s*:\s*(\d+)', win)
    if cm:
        try:
            ctime = datetime.fromtimestamp(
                int(cm.group(1)), tz=timezone(timedelta(hours=7))
            ).strftime("%Y-%m-%d %H:%M:%S")
        except (OSError, OverflowError, ValueError):
            ctime = ""
    return shop_location, ctime


def _coverage(records: list[dict]) -> tuple[str, bool]:
    """Bao cao do day du comment theo tung muc sao. Tra (dong log, co_canh_bao)."""
    lines = []
    warn = False
    for rec in records:
        pid = rec.get("id")
        got = rec.get("review_star_counts") or ""
        try:
            got_map = json.loads(got) if got else {}
        except (TypeError, ValueError):
            got_map = {}
        parts = []
        for s in (5, 4, 3, 2, 1):
            want = rec.get(f"rating_{s}")
            have = got_map.get(str(s), 0)
            if isinstance(want, int) and want > 0:
                mark = "" if have > 0 else "!"
                parts.append(f"{s}*:{have}/{want}{mark}")
                if have == 0:
                    warn = True
        total = rec.get("reviews_extracted", 0)
        lines.append(f"      {pid}: {total} comment | " + " ".join(parts))
    return "\n".join(lines), warn


def _flatten_comments(records: list[dict]) -> list[dict]:
    """Mo rong cot `reviews` (JSON) -> moi dong la 1 comment.

    De doc duoc trong Excel (o JSON qua dai, chi hien chuoi dau tien).
    Bo qua comment trong noi dung; sap theo id tang dan, sao giam dan.
    """
    rows: list[dict] = []
    for rec in records:
        raw = rec.get("reviews") or ""
        try:
            reviews = json.loads(raw) if raw else []
        except (TypeError, ValueError):
            continue
        for r in reviews:
            text = (r.get("comment") or "").strip()
            if not text:
                continue
            try:
                star = int(r.get("rating"))
            except (TypeError, ValueError):
                star = ""
            attrs = r.get("attributes") or {}
            rows.append(
                {
                    "id": rec.get("id"),
                    "name": rec.get("name", ""),
                    "star": star,
                    "comment": text,
                    "user": r.get("user", ""),
                    "time": r.get("time", ""),
                    "variant": r.get("variant", ""),
                    "attributes": "; ".join(f"{k}: {v}" for k, v in attrs.items()),
                    "seller_response": r.get("seller_response", ""),
                    "helpful": r.get("helpful", ""),
                    "media_count": len(r.get("media") or []),
                    "cmtid": r.get("cmtid", ""),
                }
            )
    rows.sort(
        key=lambda x: (
            x["id"] if isinstance(x["id"], int) else 0,
            -(x["star"] if isinstance(x["star"], int) else 0),
        )
    )
    return rows


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

    # Ten shop: ld+json Product -> offers.seller (Organization) luon co tren PDP;
    # "shop_name" trong JSON thi hay bi thieu/nham trong i18n.
    shop_name = ""
    offers_list = _as_list(prod.get("offers")) if prod.get("offers") else []
    if offers_list and isinstance(offers_list[0], dict):
        seller = offers_list[0].get("seller")
        if isinstance(seller, dict) and seller.get("name"):
            shop_name = html.unescape(str(seller["name"])).strip()
    if not shop_name:
        om = re.search(
            r'"@type"\s*:\s*"Organization"\s*,\s*"name"\s*:\s*"([^"]+)"', data
        )
        if om:
            shop_name = html.unescape(om.group(1)).strip()
    if not shop_name:
        sm = re.search(r'"shop_name"\s*:\s*"([^"]+)"', data)
        shop_name = html.unescape(sm.group(1)) if sm else ""

    # Sold: JSON luon null trong trang da luu -> doc tu DOM "Đã bán N"
    # (chuoi '1k+' -> 1000). Fallback: historical_sold JSON neu co.
    sold: int | str = ""
    dm = re.search(r"Đ\s*ã\s*b\s*án\s*<span[^>]*>([^<]+)</span>", data)
    if dm:
        sold = _sold_count(dm.group(1))
    if sold == "":
        sm2 = re.search(r'"historical_sold"\s*:\s*(\d+)', data)
        sold = int(sm2.group(1)) if sm2 else ""

    shop_location, ctime = ("", "")
    if itemid is not None:
        shop_location, ctime = _bff_fields(data, itemid)

    rv = parse_reviews(data)
    if rating is None and rv["rating_score"] != "":
        rating = rv["rating_score"]
    if not reviews and rv["rating_breakdown"]:
        reviews = sum(
            c for k, c in rv["rating_breakdown"].items()
            if "Sao" in k or "star" in k.lower()
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
            "shop_location": shop_location,
            "ctime": ctime,
            "sold": sold,
            "rating_breakdown": rv["rating_breakdown"],
            "reviews": rv["reviews"],
        }
    }


def main() -> int:
    groups = iter_pages(PAGES_DIR, recursive=True)
    if not groups:
        log(f"[X] Khong co file .html nao trong {PAGES_DIR}")
        return 1

    ensure_dirs()
    produced = False
    lock_error = False
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
            else:
                added = _merge_entry(cards[pid], entry)
                if added:
                    log(f"      ~ {pid} | +{added} comment (gop trang khac muc sao)")

        if not cards:
            log(f"      (ngay {date}: khong co trang chi tiet)")
            continue

        records = [normalize(e, date) for e in cards.values()]
        report, warn = _coverage(records)
        if report:
            log("      --- do day du comment (5* = 5 Sao: da lay / tong tren Shopee) ---")
            log(report)
        if warn:
            log(
                "      [!] Co muc sao co danh gia nhung CHUA trich duoc comment (dau '!')."
            )
            log("          -> mo lai tab muc sao do, bam 'Xem them' roi Ctrl+S them.")
        rows = _flatten_comments(records)
        if rows:
            try:
                cmt_path = save_comments_csv(rows, date)
                log(f"      -> {len(rows)} comment tung dong -> {cmt_path}")
            except PermissionError:
                lock_error = True
                log(
                    f"      [X] Khong ghi duoc shopee_comments_{date}.csv — file "
                    f"nang mo trong Excel. Hay DONG file do di roi chay lai."
                )
        try:
            csv_path = save_csv(records, PREFIX, date)
        except PermissionError:
            lock_error = True
            log(
                f"      [X] Khong ghi duoc {PREFIX}_{date}.csv — file nang mo trong "
                f"Excel. Hay DONG file do di roi chay lai."
            )
            continue
        save_raw(records, PREFIX, date)
        save_summary(records, PREFIX, date, files_merged=len(files))
        log(f"[OK] ngay {date}: {len(records)} san pham chi tiet -> {csv_path}")
        produced = True

    if not produced:
        if lock_error:
            log(
                "[X] Khong ghi duoc CSV nao vi file dang mo trong Excel. "
                "Hay DONG cac file do di roi chay lai."
            )
            return 3
        log("[X] Khong tim thay trang chi tiet nao (thieu khoi ld+json Product).")
        return 2
    if lock_error:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())