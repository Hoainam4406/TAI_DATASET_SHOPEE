"""Trich danh sach URL trang CHI TIET san pham tu cac trang listing da luu.

Khong gui request nao tới Shopee: chi doc file .html da luu tren may.

Dau vao : F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD>\\*.html
Ket qua : F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD>\\product_urls.txt
          (moi dong 1 URL PDP, da khu trung — tach rieng theo tung NGAY CAO)
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.storage import iter_pages  # noqa: E402

PAGES_DIR = str(config.PAGES_DIR)

_HREF = re.compile(r'href="(https://shopee\.vn/[^"]*?-i\.\d+\.\d+[^"]*?)"', re.I)


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def main() -> int:
    groups = iter_pages(PAGES_DIR)
    if not groups:
        log(f"[X] Khong co file .html nao trong {PAGES_DIR}")
        return 1

    produced = False
    for date, folder, files in groups:
        urls: dict = {}
        for path in files:
            data = open(path, encoding="utf-8", errors="ignore").read()
            for m in _HREF.finditer(data):
                url = m.group(1).split("?")[0]
                key = re.search(r"-i\.(\d+\.\d+)", url)
                if key:
                    urls.setdefault(key.group(1), url)

        if not urls:
            log(f"      (ngay {date}: khong tim thay URL san pham)")
            continue

        folder.mkdir(parents=True, exist_ok=True)
        out = folder / "product_urls.txt"
        out.write_text("\n".join(urls.values()), encoding="utf-8")
        log(f"[OK] ngay {date}: {len(urls)} URL san pham -> {out}")
        produced = True

    if not produced:
        log("[X] Khong tim thay URL san pham nao.")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
