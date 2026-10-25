"""Chuan hoa du lieu Shopee -> schema giong du lieu Tiki mau.

19 cot goc (giong file tiki_products_*.csv):
    id, name, price, original_price, discount_rate, rating_average,
    review_count, sold_count, seller_id, seller_name, brand_name,
    category_id, thumbnail_url, main_image_url, all_image_urls, url_path,
    favourite_count, created_at_snapshot
"""

from __future__ import annotations

import json
import re
from typing import Any

CF_BASE = "https://cf.shopee.vn/file/"

BASE_COLUMNS = [
    "id",
    "name",
    "price",
    "original_price",
    "discount_rate",
    "rating_average",
    "review_count",
    "sold_count",
    "seller_id",
    "seller_name",
    "brand_name",
    "category_id",
    "thumbnail_url",
    "main_image_url",
    "all_image_urls",
    "url_path",
    "favourite_count",
    "created_at_snapshot",
]

# Cot bo sung rieng cho Shopee (them sau 19 cot goc)
EXTRA_COLUMNS = [
    "shop_location",
    "stock",
    "liked_count",
    "ctime",
    "description",
    "rating_breakdown",
    "rating_5",
    "rating_4",
    "rating_3",
    "rating_2",
    "rating_1",
    "review_with_comment",
    "review_with_media",
    "reviews",
]


# So "da ban" hien tren giao dien: "10k+", "1,6k", "1,2tr", "282", "1.234"
# (?![\d.,]|\s*[₫đ]) : khong lay gia tien ("584.364 ₫") lam so da ban.
_NUM = r"\d[\d.,]*\s*(?:k|tr|triệu|m)?\+?(?![\d.,]|\s*[₫đ])"
_TAG = re.compile(r"<[^>]+>")
# 2 thu tu: "Đã bán 10k+" (nhan truoc, chi tieng Viet) va "10k+ Sold" (so truoc).
# - "4.9 Đã bán 10k+": "Đã bán" theo sau la so -> khong doc 4.9.
# - huy hieu "2 Sold 584.364 ₫ ... 3k+ sold": "Sold" theo sau la gia -> bo qua 2.
#   (nhung "20k+ sold 3-5 Days" van hop le)
_SOLD = re.compile(
    rf"đã\s*bán\s*({_NUM})"
    rf"|({_NUM})\s*(?:đã\s*bán(?!\s*\d)|sold(?!\s*\d[\d.,]*\s*[₫đ]))",
    re.I,
)


def parse_sold(text: str | None) -> int | str:
    """Doi '10k+' -> 10000, '1,6k' -> 1600, '1,2tr' -> 1200000, '1.234' -> 1234."""
    s = (text or "").strip().lower().replace(" ", "").rstrip("+")
    mult = 1
    for suffix, m in (("triệu", 1_000_000), ("tr", 1_000_000), ("m", 1_000_000), ("k", 1000)):
        if s.endswith(suffix):
            mult, s = m, s[: -len(suffix)]
            break
    if mult == 1:
        # khong co hau to: dau . / , la phan cach hang nghin
        s = s.replace(".", "").replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return int(round(float(s) * mult))
    except ValueError:
        return ""


def find_sold(html_text: str) -> int | str:
    """Tim so 'da ban' DAU TIEN trong doan HTML (ho tro 'Đã bán' va 'Sold')."""
    m = _SOLD.search(_TAG.sub(" ", html_text or ""))
    return parse_sold(m.group(1) or m.group(2)) if m else ""


_BOM = chr(0xFEFF)


def trim(text: Any) -> str:
    """Bo khoang trang VA ky tu BOM o 2 dau — giong String.trim() cua JS (extension).

    str.strip() cua Python khong coi BOM la khoang trang, nen mo ta Shopee hay con
    duoi "\\n\\n<BOM>\\n\\n<BOM>" o cuoi.
    """
    s = str(text or "")
    while True:
        t = s.strip().strip(_BOM)
        if t == s:
            return t
        s = t


def _empty(value: Any) -> bool:
    return value is None or value == "" or (isinstance(value, list) and not value)


def _image_url(image_hash: str | None, thumb: bool = False) -> str:
    if not image_hash:
        return ""
    if image_hash.startswith("http"):
        return image_hash
    return f"{CF_BASE}{image_hash}{'_tn' if thumb else ''}"


def _to_price(value: Any) -> int | str:
    """Shopee luu gia dang so nguyen x 100000. VD 39.000d -> 3900000000."""
    if _empty(value):
        return ""
    try:
        return int(round(int(value) / 100000))
    except (TypeError, ValueError):
        return ""


def _slug(text: str, max_len: int = 80) -> str:
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s-]+", "-", text).strip("-")
    return text[:max_len]


def _product_url(name: str, shopid: Any, itemid: Any, host: str) -> str:
    slug = _slug(name)
    if slug and shopid and itemid:
        return f"https://{host}/{slug}-i.{shopid}.{itemid}"
    if shopid and itemid:
        return f"https://{host}/product/{shopid}/{itemid}"
    return ""


def _rating_stats(item: dict) -> tuple[float, Any]:
    rating = item.get("item_rating") or {}
    star = rating.get("rating_star") or item.get("rating_star") or 0
    counts = rating.get("rating_count")
    if isinstance(counts, list) and counts:
        review = sum(int(c) for c in counts)
    else:
        review = item.get("cmt_count") or item.get("review_count") or 0
    try:
        star = round(float(star), 2)
    except (TypeError, ValueError):
        star = 0.0
    return star, review


def normalize(data: dict, snapshot_ts: str, host: str = "shopee.vn") -> dict:
    """Nhan 1 entry search ({"item_basic": ...}) hoac 1 dict item chi tiet."""
    item = data.get("item_basic") if "item_basic" in data else data
    item = item or {}

    itemid = item.get("itemid") or item.get("item_id")
    shopid = item.get("shopid") or item.get("shop_id")

    images = item.get("images") or []
    main_hash = images[0] if images else item.get("image")
    all_urls = [_image_url(h) for h in images]
    if not all_urls and main_hash:
        all_urls = [_image_url(main_hash)]

    price = _to_price(item.get("price"))
    original = _to_price(item.get("price_before_discount")) or price
    discount: Any = ""
    if isinstance(price, int) and isinstance(original, int) and original > price:
        discount = round((1 - price / original) * 100, 2)

    rating_star, review_count = _rating_stats(item)

    categories = item.get("categories") or []
    category_id = item.get("catid") or ""
    if not category_id and categories:
        last = categories[-1]
        category_id = last.get("catid", "") if isinstance(last, dict) else ""

    shop = item.get("shop") or {}
    seller_name = (
        item.get("shop_name")
        or (shop.get("name") if isinstance(shop, dict) else "")
        or ""
    )

    brand = item.get("brand") or ""
    if isinstance(brand, dict):
        brand = brand.get("name", "")

    liked = item.get("liked_count", "")

    breakdown = item.get("rating_breakdown") or {}
    reviews = item.get("reviews") or []

    stars: dict = {}
    for key, val in breakdown.items():
        m = re.match(r"\s*(\d)\s*Sao", key, re.I)
        if m:
            stars[f"rating_{m.group(1)}"] = val
        elif "Bình luận" in key:
            stars["review_with_comment"] = val
        elif "hình ảnh" in key or "video" in key:
            stars["review_with_media"] = val

    return {
        "id": itemid,
        "name": trim(item.get("name")),
        "price": price,
        "original_price": original,
        "discount_rate": discount,
        "rating_average": rating_star,
        "review_count": review_count,
        "sold_count": item.get("sold", ""),
        "seller_id": shopid,
        "seller_name": seller_name,
        "brand_name": trim(brand),
        "category_id": category_id,
        "thumbnail_url": _image_url(main_hash, thumb=True),
        "main_image_url": _image_url(main_hash),
        "all_image_urls": json.dumps(all_urls, ensure_ascii=False),
        "url_path": _product_url(item.get("name", ""), shopid, itemid, host),
        "favourite_count": liked,
        "created_at_snapshot": snapshot_ts,
        "shop_location": item.get("shop_location", ""),
        "stock": item.get("stock", ""),
        "liked_count": liked,
        "ctime": item.get("ctime", ""),
        "description": item.get("description", ""),
        "rating_breakdown": (
            json.dumps(breakdown, ensure_ascii=False) if breakdown else ""
        ),
        "rating_5": stars.get("rating_5", ""),
        "rating_4": stars.get("rating_4", ""),
        "rating_3": stars.get("rating_3", ""),
        "rating_2": stars.get("rating_2", ""),
        "rating_1": stars.get("rating_1", ""),
        "review_with_comment": stars.get("review_with_comment", ""),
        "review_with_media": stars.get("review_with_media", ""),
        "reviews": json.dumps(reviews, ensure_ascii=False) if reviews else "",
    }


def merge(base: dict, detail: dict) -> dict:
    """Gop ban ghi tu search voi ban ghi chi tiet (chi tiet uu tien)."""
    merged = dict(base)
    for key, value in detail.items():
        if not _empty(value):
            merged[key] = value
    return merged
