"""Mo cac trang CHI TIET san pham trong Chrome thuong cua ban.

Dung danh sach URL da trich tu extract_product_urls.py:
    crawl_manually\\<YYYY-MM-DD>\\product_urls.txt

Chrome BINH THUONG (khong automation, khong CDP -> khong bi gan co).

== Mo lan luot 5 tab, KHONG trung lap ==
Mac dinh script ghi nho vi tri da mo (file .url_cursor trong thu muc ngay),
nen chi can chay LAP LAI cung 1 lenh:

    python open_product_tabs.py 5      # lan 1 -> tab 1..5
    python open_product_tabs.py 5      # lan 2 -> tab 6..10
    python open_product_tabs.py 5      # lan 3 -> tab 11..15 ...

Them --skip-saved de CHAC CHAN khong trung: script tu doc cac trang PDP da luu
trong thu muc ngay va chi mo nhung san pham CHUA co PDP (bo qua ca truong hop
ban quen luu vai tab).

Cac kieu mo:
    python open_product_tabs.py                    # 5 tab ke tiep, ngay moi nhat
    python open_product_tabs.py 5                  # 5 tab ke tiep
    python open_product_tabs.py 5 --skip-saved     # 5 SP chua luu PDP
    python open_product_tabs.py 5 --date 2026-10-15
    python open_product_tabs.py 5 --skip-saved --date 2026-10-15
    python open_product_tabs.py all                # TAT CA con lai cua ngay
    python open_product_tabs.py all --skip-saved   # TAT CA nhung SP chua luu
    python open_product_tabs.py all --all-days     # TAT CA san pham cua MOI ngay
    python open_product_tabs.py --reset [--date YYYY-MM-DD]

Mac dinh dung thu muc NGAY MOI NHAT (neu khong truyen --date).
Voi danh sach qua dai, script tu chia nhieu lan mo de khong vuot gioi han do
dai dong lenh cua Windows.

Sau khi mo: sang tung tab -> Ctrl+S (Webpage, HTML Only) -> luu vao thu muc
ngay tuong ung F:\\SHOPEE\\crawl_manually\\<YYYY-MM-DD> -> dong tab.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.storage import list_page_dirs, newest_date  # noqa: E402

PAGES_DIR = str(config.PAGES_DIR)

# Gioi han an toan do dai dong lenh Windows (~32767 ky tu) va so tab/lan.
_MAX_CHARS = 28000
_MAX_COUNT = 100


def find_chrome_path():
    """Tim duong dan chrome.exe (Google Chrome that)."""
    candidates = [
        os.environ.get("SHOPEE_CHROME_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def load_urls(urls_file: Path) -> list[str]:
    if not urls_file.exists():
        return []
    return [ln.strip() for ln in urls_file.read_text(encoding="utf-8").splitlines() if ln.strip()]


def collect_all_days() -> list[tuple[str, str]]:
    """[(date, url)] cho TAT CA ngay, khu trung theo shopid.itemid, giu thu tu ngay."""
    seen: dict[str, str] = {}
    out: list[tuple[str, str]] = []
    for date, folder in list_page_dirs(PAGES_DIR):
        for url in load_urls(folder / "product_urls.txt"):
            key = _url_key(url)
            if key in seen:
                continue
            seen[key] = url
            out.append((date, url))
    return out


def _url_key(url: str) -> str:
    m = re.search(r"-i\.(\d+\.\d+)", url)
    return m.group(1) if m else url


def _url_itemid(url: str) -> str | None:
    m = re.search(r"-i\.\d+\.(\d+)", url)
    return m.group(1) if m else None


def saved_itemids(folders: list[Path]) -> set[str]:
    """itemid cua cac san pham DA co trang PDP luu trong cac thu muc nay."""
    from parse_saved_products import parse_file as parse_pdp  # import muon, tranh vong

    ids: set[str] = set()
    for folder in folders:
        for f in sorted(list(folder.glob("*.html")) + list(folder.glob("*.htm"))):
            try:
                entry = parse_pdp(str(f))
            except Exception:  # noqa: BLE001
                entry = None
            if entry:
                iid = entry["item_basic"].get("itemid")
                if iid:
                    ids.add(str(iid))
    return ids


def read_cursor(cursor_file: Path) -> int:
    if cursor_file.exists():
        try:
            return int(cursor_file.read_text(encoding="utf-8").strip())
        except ValueError:
            return 0
    return 0


def write_cursor(cursor_file: Path, value: int) -> None:
    cursor_file.parent.mkdir(parents=True, exist_ok=True)
    cursor_file.write_text(str(value), encoding="utf-8")


def _chunks(urls: list[str]):
    """Chia URLs thanh nhieu nhom nho de mo, tranh vuot gioi han dong lenh."""
    chunk: list[str] = []
    size = 0
    for url in urls:
        if chunk and (size + len(url) + 1 > _MAX_CHARS or len(chunk) >= _MAX_COUNT):
            yield chunk
            chunk, size = [], 0
        chunk.append(url)
        size += len(url) + 1
    if chunk:
        yield chunk


def main() -> int:
    args = list(sys.argv[1:])

    all_days = "--all-days" in args
    if all_days:
        args.remove("--all-days")

    skip_saved = "--skip-saved" in args
    if skip_saved:
        args.remove("--skip-saved")

    reset = "--reset" in args
    if reset:
        args.remove("--reset")

    date = None
    if "--date" in args:
        idx = args.index("--date")
        if idx + 1 < len(args):
            date = args[idx + 1]
        del args[idx:idx + 2]

    if all_days:
        if reset:
            log("[i] --all-days khong dung con tro, bo qua --reset.")
        rows = collect_all_days()
        if not rows:
            log("[X] Khong co product_urls.txt o ngay nao. Chay extract_product_urls.py truoc.")
            return 1
        folder = None
        cursor_file = None
        folders = [f for _d, f in list_page_dirs(PAGES_DIR)]
        urls = [u for _d, u in rows]
        label = f"tat ca {len(folders)} ngay"
    else:
        date = date or newest_date(PAGES_DIR)
        if not date:
            log("[X] Chua co du lieu. Luu trang .html vao crawl_manually truoc.")
            return 1
        folder = Path(PAGES_DIR) / date
        cursor_file = folder / ".url_cursor"
        folders = [folder]
        urls = load_urls(folder / "product_urls.txt")
        if not urls:
            log(f"[X] Chua co {folder / 'product_urls.txt'}. Chay extract_product_urls.py truoc.")
            return 1
        label = f"ngay {date}"

        if reset:
            write_cursor(cursor_file, 0)
            log(f"[OK] Da xoa con tro ngay {date} -> quay ve dau danh sach.")
            return 0

    open_all = False
    count = 5
    start = None
    if args:
        if args[0].lower() == "all":
            open_all = True
        else:
            try:
                count = int(args[0])
            except ValueError:
                pass
    if len(args) > 1:
        try:
            start = int(args[1])
        except ValueError:
            pass

    cursor = 0
    if skip_saved:
        saved = saved_itemids(folders)
        candidates = [u for u in urls if (_url_itemid(u) or u) not in saved]
        batch = candidates if open_all else candidates[:count]
        remaining = max(0, len(candidates) - len(batch))
        if saved:
            log(f"[i] Bo qua {len(urls) - len(candidates)}/{len(urls)} san pham da co PDP.")
    else:
        if cursor_file is not None:
            cursor = read_cursor(cursor_file) if start is None else start
        batch = urls if all_days else (urls[cursor:] if open_all else urls[cursor:cursor + count])
        remaining = 0 if all_days else max(0, len(urls) - (cursor + len(batch)))

    if not batch:
        log(f"[i] {label}: khong con san pham nao can mo (tong {len(urls)}).")
        return 0

    chrome = find_chrome_path()
    if not chrome:
        log("[X] Khong tim thay chrome.exe.")
        return 2

    if len(batch) > 50:
        log(f"[i] Se mo {len(batch)} tab — Chrome co the hoi cham, vui long doi.")

    opened = 0
    for chunk in _chunks(batch):
        subprocess.Popen([chrome] + chunk)
        opened += len(chunk)

    if cursor_file is not None and not all_days and not skip_saved:
        write_cursor(cursor_file, cursor + len(batch))

    log(f"[OK] Da mo {opened} tab ({label}).")
    if folder is not None:
        log(f"     Sang tung tab -> Ctrl+S (Webpage, HTML Only) -> luu vao {folder}")
    else:
        log("     Sang tung tab -> Ctrl+S (Webpage, HTML Only) -> luu vao thu muc NGAY tuong ung")
        log("     (hoac luu vao F:\\SHOPEE\\crawl_manually roi chay organize_pages.py).")
    if remaining > 0:
        log(f"     Con lai {remaining} san pham. Chay lai de mo tiep.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
