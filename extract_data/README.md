# extract_data

Các script bóc dữ liệu Shopee từ trang đã lưu thủ công (Ctrl+S).

> **Hướng dẫn sử dụng đầy đủ nằm ở:** [`..\README.md`](../README.md)

## Chạy nhanh

```powershell
cd F:\SHOPEE\extract_data
python run_pipeline.py
```

## Các script

| Script | Việc |
|---|---|
| `run_pipeline.py` | Chạy cả 5 bước dưới cùng lúc |
| `organize_pages.py` | Gom `.html` lẻ → `crawl_manually\<ngày>\` |
| `extract_product_urls.py` | Listing → `crawl_manually\<ngày>\product_urls.txt` |
| `open_product_tabs.py [N\|all] [--date YYYY-MM-DD] [--all-days] [--skip-saved]` | Mở N / **tất cả** tab sản phẩm trong Chrome để Ctrl+S (nhớ vị trí `.url_cursor`, không trùng) |
| `open_review_tabs.py [<id>\|all] [--date YYYY-MM-DD] [--count N] [--loop] [--stars 5,4,3,2,1] [--reset]` | Chạy trần = **mỗi lần mở 1 sản phẩm** (Enter để tiếp); mở **N tab review** (mỗi mức sao 1 tab) để Ctrl+S. **Bộ đếm tự đổi tên** file mới theo mức sao → không bị hỏi "Replace it?" |
| `organize_reviews.py [<ngày>] [--dry]` | (Backup) Đổi tên file review theo mức sao (`<id>_s5.html`…) — dùng khi bị hỏi "Replace it?" hoặc đổi tên sau |
| `parse_saved_pages.py` | Listing → `csv_processed\shopee_listing_<ngày>.csv` |
| `parse_saved_products.py` | Chi tiết → `csv_processed\shopee_detail_<ngày>.csv` (gộp comment mọi mức sao, **quét cả `reviews\<id>\`**) + `shopee_comments_<ngày>.csv` (1 dòng/comment, dễ đọc trong Excel) |
| `download_saved_images.py` | Ảnh → `image\<ngày>\{id}_main.jpg` |

Các script bóc dữ liệu **lặp theo từng thư mục ngày** (`crawl_manually\<YYYY-MM-DD>\`),
nên cào nhiều ngày sẽ ra nhiều bộ CSV/ảnh tách riêng theo ngày.

> Trang review (lọc sao) được lưu vào `crawl_manually\<ngày>\reviews\<id>\` để tên
> file không đè nhau. `parse_saved_products.py` tự quét các thư mục con này (bỏ qua
> `_files`) và **gộp comment theo `cmtid`**, in báo cáo độ phủ `5*:6/24 ...`.
> Vì 5 tab review có cùng tiêu đề trang nên Chrome gợi ý **cùng một tên file** →
> Windows sẽ hỏi **"Replace it?"**. Khi `open_review_tabs.py` còn chạy (chờ Enter)
> nó có **bộ đếm theo dõi thư mục** và **tự đổi tên** file mới thành
> `<id>_s<sao>.html` ngay khi bạn Ctrl+S (chưa rõ mức → `<id>_x.html`, "tất cả"
> → `<id>_all.html`, trùng thì thêm `_2`). Backup: chạy `python organize_reviews.py`
> sau khi lưu — đọc bộ lọc sao đang bật trong từng file rồi đổi tên.

## Package `shopee_crawler\`

| File | Vai trò |
|---|---|
| `config.py` | Đường dẫn `crawl_manually`, `image`, `csv_processed` |
| `parser.py` | Map dữ liệu Shopee → schema 19 cột (giống Tiki) |
| `storage.py` | Lưu CSV/JSON, tính **ngày cào** (`crawl_date`), quét file (kể cả thư mục con) |
| `images.py` | Tải ảnh, chia thư mục theo ngày cào |
| `reviews.py` | Bóc khối đánh giá: điểm, phân bố sao, danh sách comment (`cmtid`) |

Mọi script chạy **offline** (chỉ đọc `.html` cục bộ); riêng tải ảnh lấy từ CDN
ảnh công khai của Shopee.
