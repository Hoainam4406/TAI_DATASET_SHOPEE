"""Doi ten cac trang REVIEW da luu thanh ten DUY NHAT theo muc sao (BACKUP).

Van de: 5 tab (5 muc sao) cua cung 1 san pham co CUNG tieu de trang, nen Chrome
goi y cung 1 ten file -> Windows hoi "Replace it?" khi luu (khong tu them (1),(2)
nhu download). Neu bam Replace se mat file truoc.

Trong binh thuong, open_review_tabs.py (khi dang chay/cho Enter) se TU DOI TEN
file moi thanh <id>_s<sao>.html ngay khi ban Ctrl+S. Script nay la BACKUP: chay
sau khi luu (hoac khi bi hoi Replace) de doi ten cac file con lai.

Script nay doc bo loc "N Sao dang bat" (product-rating-overview__filter--active)
trong tung file va doi ten thanh:
    <itemid>_s5.html   (dang loc 5 sao)
    <id>_all.html      (dang o "tat ca")
    <id>_x.html        (khong xac dinh duoc muc sao)
Neu trung ten -> them _2, _3... File da doi ten dung chuan se duoc giu nguyen
(chay lai nhieu lan van an toan).

HOAN TOAN OFFLINE. Cach dung:
    python organize_reviews.py            # tat ca cac ngay
    python organize_reviews.py 2026-10-18 # 1 ngay
    python organize_reviews.py --dry      # chi in, khong doi ten
"""

import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.reviews import active_star  # noqa: E402

PAGES_DIR = str(config.PAGES_DIR)
_NAMED = r"^(?P<id>\d+)_(?P<tag>s[1-5]|all|x)(?:_\d+)?\.html$"


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def _tag(star) -> str:
    if isinstance(star, int):
        return f"s{star}"
    return "all" if star == "all" else "x"


def organize_folder(folder: str, dry: bool = False) -> list[tuple[str, str]]:
    files = sorted(glob.glob(os.path.join(folder, "*.html")))
    pid = os.path.basename(folder)
    claimed: set[str] = set()
    pending: list[str] = []

    for path in files:
        name = os.path.basename(path)
        m = re.match(_NAMED, name)
        if m and m.group("id") == pid:
            claimed.add(name)
        else:
            pending.append(path)

    changes: list[tuple[str, str]] = []
    for path in pending:
        try:
            data = open(path, encoding="utf-8", errors="ignore").read()
        except OSError as exc:
            log(f"      ! khong doc duoc {os.path.basename(path)[:40]}: {exc}")
            continue
        star = active_star(data)
        base = f"{pid}_{_tag(star)}"
        target = f"{base}.html"
        n = 2
        while target in claimed:
            target = f"{base}_{n}.html"
            n += 1
        claimed.add(target)
        if target != os.path.basename(path):
            changes.append((path, os.path.join(folder, target)))

    for src, dst in changes:
        if dry:
            log(f"      {os.path.basename(src)[:38]:40} -> {os.path.basename(dst)}")
        else:
            try:
                os.replace(src, dst)
                log(f"      {os.path.basename(src)[:38]:40} -> {os.path.basename(dst)}")
            except OSError as exc:
                log(f"      ! doi ten loi {os.path.basename(src)[:35]}: {exc}")
    return changes


def _dates(argv: list[str]) -> list[str]:
    explicit = [a for a in argv if re.match(r"^\d{4}-\d{2}-\d{2}$", a)]
    if explicit:
        return explicit
    if not os.path.isdir(PAGES_DIR):
        return []
    return sorted(
        d for d in os.listdir(PAGES_DIR)
        if os.path.isdir(os.path.join(PAGES_DIR, d, "reviews"))
    )


def main(argv: list[str]) -> int:
    dry = "--dry" in argv
    dates = _dates(argv)
    if not dates:
        log(f"[X] Khong tim thay thu muc reviews\\ nao trong {PAGES_DIR}")
        return 1

    total = 0
    for date in dates:
        rev_root = os.path.join(PAGES_DIR, date, "reviews")
        folders = sorted(
            d for d in os.listdir(rev_root)
            if os.path.isdir(os.path.join(rev_root, d))
        )
        if not folders:
            continue
        log(f"[i] Ngay {date}: {len(folders)} san pham co thu muc review")
        for pid in folders:
            changed = organize_folder(os.path.join(rev_root, pid), dry=dry)
            total += len(changed)
            if not changed:
                log(f"      {pid}: khong can doi ten")

    verb = "se doi ten" if dry else "da doi ten"
    log(f"[OK] {verb} {total} file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
