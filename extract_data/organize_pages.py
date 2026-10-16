"""Sap xep cac file .html luu thu cong vao THU MUC THEO NGAY CAO.

Chrome luu Ctrl+S vao mot thu muc co dinh. Script nay tu gom moi file .html
(va thu muc _files di kem neu co) vao:

    F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD>\\

theo thoi diem luu (mtime). Nho vay du lieu cao nhieu ngay duoc tach bach,
moi ngay xu ly ra 1 CSV va 1 thu muc anh rieng.

File da nam trong thu muc ngay roi thi giu nguyen (khong di chuyen lai).

Cach dung:
    python organize_pages.py
"""

import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.storage import list_page_dirs, mtime_date  # noqa: E402


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def main() -> int:
    base = Path(config.PAGES_DIR)
    if not base.exists():
        log(f"[X] Chua co thu muc {base}")
        return 1

    moved = 0
    for f in sorted(list(base.glob("*.html")) + list(base.glob("*.htm"))):
        date = mtime_date(f)
        dest_dir = base / date
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f.name
        if dest.exists():
            log(f"      ! da co, bo qua: {date}/{f.name}")
            continue
        shutil.move(str(f), str(dest))
        moved += 1

        sibling = base / (f.stem + "_files")
        if sibling.exists():
            target = dest_dir / sibling.name
            if not target.exists():
                shutil.move(str(sibling), str(target))

    dirs = list_page_dirs(base)
    if moved:
        log(f"[OK] Da sap xep {moved} file .html theo ngay.")
    else:
        log("[i] Khong co file .html roi o goc crawl_manually (da sap xep san).")

    for date, folder in dirs:
        n = len(list(folder.glob("*.html")) + list(folder.glob("*.htm")))
        log(f"      {date}: {n} file")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
