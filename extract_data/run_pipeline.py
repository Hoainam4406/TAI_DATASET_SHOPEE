"""Chay TOAN BO pipeline boc du lieu (offline) chi bang 1 lenh.

    python run_pipeline.py

Thu tu thuc hien:
  1. organize_pages.py         (gom .html le -> crawl_manually\\<ngay>\\)
  2. extract_product_urls.py   (trang listing -> <ngay>\\product_urls.txt)
  3. parse_saved_pages.py      (trang listing -> shopee_listing_<ngay>.csv)
  4. parse_saved_products.py   (trang PDP     -> shopee_detail_<ngay>.csv)
  5. download_saved_images.py  (anh -> image\\<ngay>\\)

Du lieu cao nhieu ngay duoc tach theo NGAY (thu muc crawl_manually\\<YYYY-MM-DD>),
moi ngay ra 1 CSV + 1 thu muc anh rieng. Moi buoc doc cac file .html trong
F:\\SHOPEE\\crawl_manually va ghi ket qua ra csv_processed\\ + image\\. Khong buoc
nao gui request toi Shopee (chi doc file cuc bo; rieng buoc 5 tai anh tu CDN anh
cong khai).

Neu mot buoc khong co du lieu (vd chua luu trang nao) buoc do se bao "khong co"
va pipeline van chay tiep cac buoc con lai.
"""

import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

STEPS = [
    ("organize_pages", "Sap xep file .html vao thu muc theo NGAY CAO"),
    ("extract_product_urls", "Boc link san pham tu trang danh sach"),
    ("parse_saved_pages", "Trich du lieu trang DANH SACH -> CSV"),
    ("parse_saved_products", "Trich du lieu trang CHI TIET -> CSV"),
    ("download_saved_images", "Tai anh san pham"),
]

LINE = "=" * 64


def main() -> int:
    results = []
    for name, desc in STEPS:
        print(f"\n{LINE}\n>> {name}: {desc}\n{LINE}", flush=True)
        try:
            module = importlib.import_module(name)
            code = module.main()
        except SystemExit as exc:  # pragma: no cover
            code = exc.code
        except Exception as exc:  # noqa: BLE001
            print(f"[X] {name} loi: {exc}", flush=True)
            code = 99
        results.append((name, code))

    print(f"\n{LINE}\nTONG KET\n{LINE}")
    for name, code in results:
        status = "OK " if code == 0 else "BO QUA/LOI"
        print(f"  [{status}] {name} (rc={code})")
    print(
        "\nGoi y:\n"
        "  - Chua co du lieu? Luu trang Shopee bang Ctrl+S vao "
        "F:\\SHOPEE\\crawl_manually (file se tu xep theo ngay).\n"
        "  - Muon mo tab san pham de luu: python open_product_tabs.py 5\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
