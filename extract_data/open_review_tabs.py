r"""Mo nhieu tab REVIEW cua 1 san pham de Ctrl+S lay comment moi muc sao.

VI SAO PHAI BAM LOC THU CONG: tren web Shopee, bo loc sao (5..1) la client-side,
KHONG nam trong URL. Khong the mo thang "trang 1 sao" bang link. Nen script se
mo san N TAB cua cung 1 san pham; ban chi viec bam loc tuong ung roi Ctrl+S.

Script tu doc so lieu da boc (csv_processed\\shopee_detail_<ngay>.csv) de biet
muc sao nao CO danh gia (bo qua muc = 0), roi mo dung bay nhieu tab.

Cach dung:
    python open_review_tabs.py                       # MO 1 SAN PHAM ke tiep (roi Enter de thoat)
    python open_review_tabs.py --count 3             # mo 3 san pham, Enter giua cac SP
    python open_review_tabs.py --loop                # mo lien tuc, Enter giua cac SP
    python open_review_tabs.py --date 2026-10-15     # chon ngay
    python open_review_tabs.py --reset               # lam lai tu san pham dau
    python open_review_tabs.py 57863192512           # chi 1 san pham cu the
    python open_review_tabs.py all                    # mo HET 1 lan (de lag Chrome!)

Quy trinh (moi che do deu cho Enter de bo dem doi ten chay):
    1. Chay lenh -> Chrome mo N tab cua DUNG 1 san pham (moi tab 1 muc sao).
       Tab thu i (trai->phai) tuong ung muc sao in ra (vd 5,4,3,2,1).
    2. Trong tung tab: keo xuong "Danh gia", bam loc sao, bam "Xem them" vai lan
       de lay nhieu comment, roi Ctrl+S (HTML Only) -> luu vao thu muc
       crawl_manually\<ngay>\reviews\<itemid>\ (script in ra san).
       CU DE TEN MAC DINH duoc: script chay BO DEM TU DOI TEN file moi ngay khi
       ban Ctrl+S -> <itemid>_s5.html, <itemid>_s4.html... nen CAC TAB KHONG BI
       HOI "Replace it?" (vi ten cu da duoc doi di truoc khi ban luu tab ke).
    3. Quay lai cua so lenh, bam Enter -> dung bo dem, ghi nhan, sang SP ke
       (hoac thoat). 'q' = thoat khong ghi nhan (chay lai van o san pham nay).
    4. Sau khi luu du, chay:  python parse_saved_products.py
       -> comment moi muc sao TU DONG GOP theo cmtid, khu trung.

"""

import csv
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shopee_crawler import config  # noqa: E402
from shopee_crawler.storage import newest_date  # noqa: E402

PAGES_DIR = str(config.PAGES_DIR)
PROCESSED_DIR = str(config.PROCESSED_DIR)

_STARS_DEFAULT = [5, 4, 3, 2, 1]


def find_chrome_path():
    candidates = [
        os.environ.get("SHOPEE_CHROME_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(
            os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"
        ),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def log(m: str) -> None:
    print(m.encode("ascii", "ignore").decode(), flush=True)


def _cursor_path(folder: Path) -> Path:
    return folder / ".review_cursor"


def load_cursor(folder: Path) -> int:
    try:
        return int(_cursor_path(folder).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0


def save_cursor(folder: Path, n: int) -> None:
    try:
        _cursor_path(folder).write_text(str(n), encoding="utf-8")
    except OSError:
        pass


def ask(prompt: str) -> str:
    try:
        return input(prompt.encode("ascii", "ignore").decode()).strip().lower()
    except EOFError:
        return "q"


def _url_itemid(url: str) -> str | None:
    m = re.search(r"-i\.\d+\.(\d+)", url)
    return m.group(1) if m else None


def load_product_urls(folder: Path) -> list[str]:
    f = folder / "product_urls.txt"
    if not f.exists():
        return []
    return [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip()]


def read_detail_rows(date: str) -> list[dict]:
    path = Path(PROCESSED_DIR) / f"shopee_detail_{date}.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def ids_from_urls(folder: Path) -> list[str]:
    ids: list[str] = []
    for url in load_product_urls(folder):
        iid = _url_itemid(url)
        if iid and iid not in ids:
            ids.append(iid)
    return ids


def stars_with_reviews(row: dict) -> list[int]:
    out = []
    for star in _STARS_DEFAULT:
        val = (row or {}).get(f"rating_{star}", "")
        try:
            if int(val) > 0:
                out.append(star)
        except (TypeError, ValueError):
            out.append(star)
    return out


def find_url(itemid: str, folder: Path, row: dict | None) -> str | None:
    for url in load_product_urls(folder):
        if _url_itemid(url) == itemid:
            return url
    if row and row.get("url_path"):
        return row["url_path"]

    from parse_saved_products import parse_file  # import muon

    for f in sorted(list(folder.glob("*.html")) + list(folder.glob("*.htm"))):
        try:
            entry = parse_file(str(f))
        except Exception:  # noqa: BLE001
            continue
        if entry and str(entry["item_basic"].get("itemid")) == itemid:
            from shopee_crawler.parser import _product_url  # noqa: PLC0415

            b = entry["item_basic"]
            return _product_url(b.get("name", ""), b.get("shopid"), b.get("itemid"), "shopee.vn")
    return None


def open_tabs(chrome: str, url: str, stars: list[int]) -> None:
    """Mo 1 tab cho moi muc sao (cung URL). Thu tu tab = thu tu stars."""
    subprocess.Popen([chrome] + [url] * len(stars))


_NAMED_RE = re.compile(r"^(?P<id>\d+)_(?P<tag>s[1-5]|all|x)(?:_\d+)?\.html$")


def watch_and_rename(save_dir: Path, itemid: str, stop: "threading.Event") -> None:
    """Poll save_dir; moi file .html moi xuat hien la doc active_star va doi ten.

    Giup tranh loi "Replace it?" cua Windows: khi ban Ctrl+S tab ke (cung ten
    mac dinh), file truoc da duoc doi ten thanh <itemid>_s<sao>.html nen ten goi
    y se khong con trung nua.
    """
    import time

    from shopee_crawler.reviews import active_star  # import muon

    def _tag(star) -> str:
        if isinstance(star, int):
            return f"s{star}"
        return "all" if star == "all" else "x"

    claimed: set[str] = set()
    for f in save_dir.glob("*.html"):
        m = _NAMED_RE.match(f.name)
        if m and m.group("id") == itemid:
            claimed.add(f.name)

    while not stop.is_set():
        try:
            for f in sorted(save_dir.glob("*.html")):
                if stop.is_set():
                    return
                if f.name in claimed:
                    continue
                # cho file viet xong (kich thuoc on dinh 2 lan doc lien tiec)
                try:
                    s1 = f.stat().st_size
                except OSError:
                    continue
                time.sleep(0.3)
                try:
                    s2 = f.stat().st_size
                except OSError:
                    continue
                if s1 != s2 or s1 == 0:
                    continue
                try:
                    data = f.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                star = active_star(data)
                base = f"{itemid}_{_tag(star)}"
                target = f"{base}.html"
                n = 2
                while target in claimed or (save_dir / target).exists():
                    target = f"{base}_{n}.html"
                    n += 1
                try:
                    f.rename(save_dir / target)
                except OSError:
                    continue
                claimed.add(target)
                log(f"     [watch] {f.name[:44]:46} -> {target}")
        except OSError:
            pass
        stop.wait(0.5)


def main() -> int:
    args = list(sys.argv[1:])

    date = None
    if "--date" in args:
        i = args.index("--date")
        if i + 1 < len(args):
            date = args[i + 1]
        del args[i:i + 2]

    forced_stars = None
    if "--stars" in args:
        i = args.index("--stars")
        if i + 1 < len(args):
            forced_stars = [int(x) for x in re.findall(r"[1-5]", args[i + 1])]
        del args[i:i + 2]

    reset = "--reset" in args
    if reset:
        args.remove("--reset")

    loop = "--loop" in args
    if loop:
        args.remove("--loop")

    count = 1
    if "--count" in args:
        i = args.index("--count")
        if i + 1 < len(args):
            try:
                count = max(1, int(args[i + 1]))
            except ValueError:
                count = 1
        del args[i:i + 2]

    positional = [a for a in args if not a.startswith("--")]
    target = positional[0] if positional else None

    date = date or newest_date(PAGES_DIR)
    if not date:
        log("[X] Chua co du lieu. Luu trang .html vao crawl_manually truoc.")
        return 1
    folder = Path(PAGES_DIR) / date
    rows = read_detail_rows(date)
    by_id = {str(r.get("id")): r for r in rows}

    if reset:
        save_cursor(folder, 0)

    chrome = find_chrome_path()
    if not chrome:
        log("[X] Khong tim thay chrome.exe.")
        return 2

    _active_watchers: list[threading.Event] = []

    def _stop_watchers() -> None:
        for ev in _active_watchers:
            ev.set()
        _active_watchers.clear()

    def open_for(itemid: str, row: dict | None) -> bool:
        stars = forced_stars or stars_with_reviews(row) or _STARS_DEFAULT
        url = find_url(itemid, folder, row)
        if not url:
            log(f"[X] {itemid}: khong tim thay URL san pham.")
            return False
        save_dir = folder / "reviews" / str(itemid)
        try:
            save_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            save_dir = folder
        order = " -> ".join(f"{i + 1}:{s} Sao" for i, s in enumerate(stars))
        log(f"[i] {itemid}: mo {len(stars)} tab ({order})")
        open_tabs(chrome, url, stars)
        stop = threading.Event()
        watcher = threading.Thread(
            target=watch_and_rename, args=(save_dir, itemid, stop), daemon=True
        )
        watcher.start()
        _active_watchers.append(stop)
        log(f"     Tab trai->phai bam loc: {', '.join(str(s) for s in stars)} Sao")
        log(f"     Luu TAT CA tab vao thu muc: {save_dir}")
        log(f"     LUU TEN MAC DINH duoc — script se TU DOI TEN file moi thanh")
        log(f"     {itemid}_s5.html, {itemid}_s4.html... ngay khi ban Ctrl+S.")
        log("     (khong con bi hoi 'Replace it?' nua; Enter de dung bo dem doi ten)")
        return True

    # Che do 1 san pham hoac 'all' (mo het 1 lan, cho Enter de bo dem doi ten chay).
    if target and target.lower() != "all":
        row = by_id.get(target)
        if open_for(target, row):
            log("    Luu xong tat ca tab -> Enter de dung bo dem doi ten va thoat.")
            ask("    >> ")
            _stop_watchers()
        log("[OK] Hoan tat. Sau khi luu, chay: python parse_saved_products.py")
        return 0

    ids = [str(r.get("id")) for r in rows if r.get("id")]
    if not ids:
        ids = ids_from_urls(folder)
        if ids:
            log(f"[i] Chua co shopee_detail_{date}.csv -> tam lay {len(ids)} link tu product_urls.txt")
            log("    (se mo du 5 muc sao; chay parse_saved_products.py de loc dung muc sao)")
    if not ids:
        log(f"[X] Khong co danh sach san pham cho ngay {date}.")
        log("    Hay luu trang PDP roi chay: python parse_saved_products.py")
        log("    Hoac chay extract_product_urls.py de co product_urls.txt.")
        return 1

    if target and target.lower() == "all":
        for itemid in ids:
            open_for(itemid, by_id.get(itemid))
        log("[OK] Da mo het. Luu xong tat ca tab -> Enter de dung bo dem doi ten.")
        ask("    >> ")
        _stop_watchers()
        log("Sau khi luu, chay: python parse_saved_products.py")
        return 0

    # Che do MAC DINH: chi mo TUNG SAN PHAM mot (tranh mo het -> lag Chrome).
    start = load_cursor(folder)
    if start >= len(ids):
        log(f"[i] Da xu ly het {len(ids)} san pham (ngay {date}).")
        log("    Chay lai voi --reset neu muon lam tu dau.")
        return 0

    limit = len(ids) if loop else count
    log(f"[i] Ngay {date}: {len(ids)} san pham. Tiep theo: #{start + 1}.")
    log(f"    Goc ngay: {folder}  (moi SP luu vao reviews\\<itemid>\\)")
    if loop:
        log("    Che do --loop: mo lien tuc, Enter de sang SP ke, 'q' de dung.")
    else:
        log(f"    Che do an toan: mo {limit} san pham roi thoat (chay lai de tiep).")

    done = 0
    i = start
    while i < len(ids) and done < limit:
        itemid = ids[i]
        row = by_id.get(itemid)
        name = (row or {}).get("name", "")
        short = name[:48].encode("ascii", "ignore").decode()
        log(f"[{i + 1}/{len(ids)}] {itemid} {short}")
        if not open_for(itemid, row):
            log("    -> bo qua (khong tim thay URL).")
            save_cursor(folder, i + 1)
            done += 1
            i += 1
            continue
        if loop:
            log("    Luu xong tat ca tab -> Enter de sang SP ke.")
        else:
            log("    Luu xong tat ca tab -> Enter de ghi nhan va thoat.")
        log("    'q' = thoat (chay lai van o SP nay) | 's' = bo qua SP nay.")
        ans = ask("    >> ")
        _stop_watchers()
        if ans == "q":
            log(f"[i] Thoat o #{i + 1}. Chay lai se tiep tuc tu #{i + 1}.")
            return 0
        save_cursor(folder, i + 1)
        done += 1
        i += 1

    if i >= len(ids):
        log("[OK] Da het danh sach. Chay: python parse_saved_products.py")
    else:
        log(f"[i] Da mo {done} san pham. Chay lai lenh de tiep tuc tu #{i + 1}.")
        log("    Sau khi luu du, chay: python parse_saved_products.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
