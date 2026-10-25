"""Gop toan bo data/<keyword_id>/<ngay>.csv trong repo GitHub cua nhom -> cac bang cuoi.

    git clone https://github.com/ten-org/shopee-data      # lan dau
    git -C shopee-data pull                               # cac lan sau
    python team_dataset/build_dataset.py shopee-data      # ghi vao team_dataset/build/

Bang tao ra (parquet; them --csv de ghi CSV):
    products          1 dong / san pham — ban cao MOI NHAT (uu tien ban co trang chi tiet)
    product_keywords  id, keyword_id, keyword, crawl_date, search_page, search_rank
                      (quan he nhieu-nhieu san pham <-> keyword, theo tung ngay)
    history           id, crawl_date, gia / da ban / diem / so danh gia theo ngay
    reviews           1 dong / danh gia (cmtid), nguoi mua da an danh (u_...)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

KEY_COLS = ["keyword", "keyword_id", "search_page", "search_rank"]
HISTORY_COLS = ["price", "original_price", "discount_rate", "sold_count", "rating_average", "review_count"]


def load_raw(repo_dir: Path) -> pd.DataFrame:
    frames = []
    for f in sorted(repo_dir.glob("data/*/*.csv")):
        df = pd.read_csv(f, encoding="utf-8-sig", dtype={"id": "Int64", "seller_id": "Int64"})
        df["crawl_date"] = f.stem
        if "keyword_id" not in df:
            df["keyword_id"] = f.parent.name
        frames.append(df)
    if not frames:
        raise SystemExit(f"[X] Khong thay file data/*/*.csv nao trong {repo_dir} (da git pull chua?)")
    raw = pd.concat(frames, ignore_index=True)
    sort_cols = ["crawl_date"] + (["crawled_at"] if "crawled_at" in raw else [])
    return raw.sort_values(sort_cols, kind="stable")


def explode_reviews(raw: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for pid, text in zip(raw["id"], raw.get("reviews", pd.Series(index=raw.index, dtype=object))):
        if not isinstance(text, str) or not text.strip():
            continue
        try:
            items = json.loads(text)
        except json.JSONDecodeError:
            continue
        for rv in items:
            rows.append({
                "cmtid": rv.get("cmtid"), "id": pid, "user": rv.get("user", ""),
                "rating": rv.get("rating"), "time": rv.get("time", ""), "variant": rv.get("variant", ""),
                "attributes": json.dumps(rv.get("attributes") or {}, ensure_ascii=False),
                "comment": rv.get("comment", ""), "media": json.dumps(rv.get("media") or [], ensure_ascii=False),
                "seller_response": rv.get("seller_response", ""), "helpful": rv.get("helpful"),
            })
    df = pd.DataFrame(rows)
    return df.drop_duplicates("cmtid", keep="last") if not df.empty else df


def build(raw: pd.DataFrame) -> dict[str, pd.DataFrame]:
    ranked = raw.sort_values(["has_detail", "crawl_date"], kind="stable") if "has_detail" in raw else raw
    products = ranked.drop_duplicates("id", keep="last").drop(columns=[c for c in KEY_COLS if c in raw])
    keywords = raw[["id", "keyword_id", "keyword", "crawl_date", "search_page", "search_rank"]].drop_duplicates(
        ["id", "keyword_id", "crawl_date"], keep="last")
    history = raw[["id", "crawl_date", *[c for c in HISTORY_COLS if c in raw]]].drop_duplicates(
        ["id", "crawl_date"], keep="last")
    return {"products": products, "product_keywords": keywords, "history": history, "reviews": explode_reviews(raw)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo_dir", type=Path, help="thu muc clone cua repo GitHub")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "build")
    ap.add_argument("--csv", action="store_true", help="ghi CSV thay vi parquet (khong can pyarrow)")
    args = ap.parse_args()

    raw = load_raw(args.repo_dir)
    print(f"[i] {len(raw)} dong tu {raw['keyword_id'].nunique()} keyword, {raw['crawl_date'].nunique()} ngay")
    args.out.mkdir(parents=True, exist_ok=True)
    for name, df in build(raw).items():
        if args.csv:
            path = args.out / f"{name}.csv"
            df.to_csv(path, index=False, encoding="utf-8-sig")
        else:
            path = args.out / f"{name}.parquet"
            df.to_parquet(path, index=False)
        print(f"[OK] {name}: {len(df)} dong -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
