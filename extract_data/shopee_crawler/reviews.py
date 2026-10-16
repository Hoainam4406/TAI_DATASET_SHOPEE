"""Boc PHAN DANH GIA (comment/review) tu trang PDP Shopee da luu (Ctrl+S).

HOAN TOAN OFFLINE. Khi tai trang, Shopee render san mot so danh gia dau tien
(thuong 5-10 cai) vao DOM:

    <div class="product-ratings">
      <div class="product-rating-overview"> ... diem 4.6, so sao tung muc ...
      <div class="product-ratings__list">
        <div class="shopee-product-comment-list">
          <div class="q2b7Oq" data-cmtid="106820267567">
            ... <a class="InK5kS">ten_nguoi_mua</a>
            ... <div class="rGdC5O"> 5 icon-rating-solid </div>   (so sao)
            ... <div class="XYk98l">2026-08-07 13:34 | Phan loai...</div>
            ... <div class="YNedDV">noi dung binh luan</div>
            ... <div class="QSiE2A">phan hoi cua nguoi ban</div>
            ... <div class="shopee-product-rating__like-count">1</div>
          </div>

Tra ve dict:
    {"rating_score": 4.6,
     "rating_breakdown": {"5 Sao": 24, "4 Sao": 2, ..., "Co Binh luan": 10, ...},
     "reviews": [ {cmtid, user, userid, rating, time, variant, attributes,
                   comment, media, seller_response, helpful}, ... ]}
"""

from __future__ import annotations

import html
import re
from typing import Any

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_CMTID = re.compile(r'data-cmtid="(\d+)"')
_MEDIA = re.compile(r"https://[^\"\s]+susercontent\.com/file/[^\"\s]+")


def _clean(text: str | None) -> str:
    text = _TAG.sub(" ", text or "")
    return _WS.sub(" ", html.unescape(text)).strip()


def _int(text: str | None) -> int | str:
    m = re.search(r"\d+", text or "")
    return int(m.group()) if m else ""


def _count(text: str | None) -> int | str:
    """Doi '1,6k' -> 1600, '329' -> 329, '1,2tr' -> 1200000."""
    s = (text or "").strip().lower().replace(" ", "")
    mult = 1
    if s.endswith("k"):
        mult, s = 1000, s[:-1]
    elif s.endswith("tr"):
        mult, s = 1_000_000, s[:-2]
    s = s.replace(",", ".")
    try:
        return int(round(float(s) * mult))
    except ValueError:
        return s


def _rating_from_stars(chunk: str) -> int | str:
    m = re.search(r'class="rGdC5O">(.*?)</div>', chunk, re.S)
    if not m:
        return ""
    return m.group(1).count("icon-rating-solid") or ""


def _attributes(chunk: str) -> dict:
    pairs = {}
    for label, value in re.findall(
        r'<span class="K5v3lN">([^<:]+):\s*</span>\s*<span>([^<]*)</span>', chunk
    ):
        label = _clean(label)
        if label:
            pairs[label] = _clean(value)
    return pairs


def _media(chunk: str) -> list:
    out: list = []
    for url in _MEDIA.findall(chunk):
        base = url.split("@")[0].rstrip("/")
        base = re.sub(r"\.(webp|jpe?g|png)$", "", base)
        if base not in out:
            out.append(base)
    return out


def parse_reviews(data: str) -> dict:
    result: dict[str, Any] = {
        "rating_score": "",
        "rating_breakdown": {},
        "reviews": [],
    }

    sm = re.search(r"product-rating-overview__rating-score[^>]*>([\d.,]+)<", data)
    if sm:
        try:
            result["rating_score"] = float(sm.group(1).replace(",", "."))
        except ValueError:
            pass

    for label, raw in re.findall(
        r"product-rating-overview__filter[^>]*>\s*<span>([^<]+?)\s*\(([^)]+)\)</span>",
        data,
    ):
        result["rating_breakdown"][_clean(label)] = _count(raw)

    positions = [(m.start(), m.group(1)) for m in _CMTID.finditer(data)]
    for i, (pos, cmtid) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else pos + 8000
        chunk = data[pos:end]

        um = re.search(r'class="InK5kS"[^>]*>([^<]+)<', chunk)
        user = html.unescape(um.group(1)).strip() if um else ""
        uid = _int(re.search(r"/buyer/(\d+)", chunk).group(1)
                   if re.search(r"/buyer/(\d+)", chunk) else "")

        time = variant = ""
        tm = re.search(r'class="XYk98l">(.*?)</div>', chunk, re.S)
        if tm:
            txt = _clean(tm.group(1))
            if "|" in txt:
                time, variant = (p.strip() for p in txt.split("|", 1))
            else:
                time = txt

        cm = re.search(r'class="YNedDV">(.*?)</div>', chunk, re.S)
        sr = re.search(r'class="QSiE2A">(.*?)</div>', chunk, re.S)
        lc = re.search(r'shopee-product-rating__like-count">([^<]*)<', chunk)

        result["reviews"].append(
            {
                "cmtid": int(cmtid),
                "user": user,
                "userid": uid,
                "rating": _rating_from_stars(chunk),
                "time": time,
                "variant": variant,
                "attributes": _attributes(chunk),
                "comment": _clean(cm.group(1)) if cm else "",
                "media": _media(chunk),
                "seller_response": _clean(sr.group(1)) if sr else "",
                "helpful": _int(lc.group(1) if lc else ""),
            }
        )
    return result
