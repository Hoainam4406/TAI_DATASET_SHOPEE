"""Cau hinh chung cho pipeline cao du lieu Shopee THU CONG (Ctrl+S).

Cau truc du an (xem README.md):
    F:\\SHOPEE\\
        crawl_manually\\   <- file .html luu bang Ctrl+S trong Chrome (dau vao)
        extract_data\\     <- cac script .py xu ly (boc du lieu offline)
        image\\            <- anh san pham, chia theo ngay cao: image\\<YYYY-MM-DD>\\
        csv_processed\\    <- CSV ket qua: <ten>_<YYYY-MM-DD>.csv

Toan bo qua trinh KHONG gui request toi Shopee ngoai viec tai anh tu CDN anh
(cf.shopee.vn) — nen khong dung tới anti-bot cua tai khoan.
"""

from __future__ import annotations

import os
from pathlib import Path

# Thu muc goc du an: F:\SHOPEE  (parents[2] = .../extract_data/shopee_crawler/config.py)
PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Dau vao: noi luu cac file .html da luu thu cong bang Ctrl+S.
PAGES_DIR = Path(os.environ.get("SHOPEE_PAGES_DIR", PROJECT_ROOT / "crawl_manually"))

# Anh san pham: chia theo ngay cao -> image\<YYYY-MM-DD>\{id}_main.jpg
IMAGES_DIR = Path(os.environ.get("SHOPEE_IMAGES_DIR", PROJECT_ROOT / "image"))

# CSV ket qua -> csv_processed\<ten>_<YYYY-MM-DD>.csv
PROCESSED_DIR = Path(
    os.environ.get("SHOPEE_PROCESSED_DIR", PROJECT_ROOT / "csv_processed")
)

# --- Tai anh tu CDN anh cua Shopee ------------------------------------------
REQUEST_TIMEOUT = float(os.environ.get("SHOPEE_REQUEST_TIMEOUT", "30"))
IMAGE_CONCURRENCY = int(os.environ.get("SHOPEE_IMAGE_CONCURRENCY", "8"))

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://shopee.vn/",
}
