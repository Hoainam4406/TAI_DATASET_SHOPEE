# Hướng dẫn thu thập dữ liệu Shopee (thủ công + bóc offline)

Bộ công cụ thu thập **dữ liệu sản phẩm Shopee** (tên, giá, rating, ảnh, mô tả,
danh mục, shop…) để dùng cho dự án **RecSys multimodal** (user + text + ảnh).

> **Cách tiếp cận:** bạn **tự lướt Shopee bằng Chrome thường** rồi lưu trang
> bằng **Ctrl+S**; các script chỉ **đọc file `.html` đã lưu** để bóc dữ liệu.
> Vì không gửi request tự động tới Shopee nên **không bị chặn / không cần đăng
> nhập lại**.

> **Mới — tự động hoá bằng Chrome extension:** `chrome_extension\` tự tìm keyword, mở
> trang sản phẩm, lưu HTML vào `crawl_manually\<ngày>\` và xuất luôn
> `csv_processed\shopee_final_<ngày>.csv` (dữ liệu cuối) + ảnh, không cần Ctrl+S hay
> chạy Python. Xem [chrome_extension/README.md](chrome_extension/README.md).

---

## 1. Yêu cầu & cài đặt

- Windows, có **Google Chrome**.
- **Python 3.10+**.

```powershell
pip install -r F:\SHOPEE\extract_data\requirements.txt
```

(chỉ cần `requests` và `pandas`)

---

## 2. Cấu trúc thư mục

```
F:\SHOPEE\
├─ crawl_manually\      # ĐẦU VÀO — tự chia theo NGÀY CÀO:
│  └─ <YYYY-MM-DD>\     #   *.html (Ctrl+S) + product_urls.txt + .url_cursor
├─ extract_data\        # SCRIPT xử lý
│  ├─ shopee_crawler\   #   config.py, parser.py, storage.py, images.py
│  ├─ run_pipeline.py       # ★ chạy 1 lệnh toàn bộ pipeline bóc dữ liệu
│  ├─ organize_pages.py         # gom .html lẻ vào crawl_manually\<ngày>\
│  ├─ extract_product_urls.py   # listing .html -> <ngày>\product_urls.txt
│  ├─ open_product_tabs.py      # mở nhanh N tab sản phẩm trong Chrome thường
│  ├─ parse_saved_pages.py      # listing .html -> CSV
│  ├─ parse_saved_products.py   # PDP .html     -> CSV (chi tiết, đủ ảnh)
│  └─ download_saved_images.py  # tải ảnh -> image\<ngày>\
├─ image\               # ẢNH: image\<YYYY-MM-DD>\{id}_main.jpg
└─ csv_processed\       # CSV + JSON: <tên>_<YYYY-MM-DD>.csv
```

**Ngày cào** = tên thư mục ngày (hoặc mtime của file `.html` lẻ, đúng thời điểm
bạn bấm Ctrl+S). Dữ liệu được **tách riêng theo từng ngày cào**: mỗi ngày →
1 thư mục `crawl_manually\<ngày>\`, 1 file `shopee_listing_<ngày>.csv` /
`shopee_detail_<ngày>.csv`, và 1 thư mục ảnh `image\<ngày>\`.

Ví dụ cào ngày 15/10/2026:
`crawl_manually\2026-10-15\` · `csv_processed\shopee_listing_2026-10-15.csv` ·
`image\2026-10-15\`.

---

## 3. Pipeline (từng bước)

### Bước 1 — Lưu trang DANH SÁCH (listing)

Trong **Chrome thường**:

1. Mở `https://shopee.vn`, tìm từ khoá (vd `laptop`).
2. **Cuộn** xuống cho sản phẩm hiện ra.
3. **Ctrl+S** → ở ô *Save as type* chọn **"Webpage, HTML Only"** → lưu vào
   `F:\SHOPEE\crawl_manually` (hoặc tạo sẵn thư mục ngày
   `crawl_manually\2026-10-15\` rồi lưu vào đó).

> Không cần tự tạo thư mục ngày: nếu bạn lưu file lẻ vào `crawl_manually`,
> bước tiếp theo (`organize_pages.py`) sẽ **tự xếp vào thư mục ngày** theo
> thời điểm lưu.

### Bước 2 — Bóc dữ liệu danh sách + lấy link sản phẩm

```powershell
cd F:\SHOPEE\extract_data
python run_pipeline.py
```

`run_pipeline.py` sẽ tự chạy lần lượt: **sắp xếp theo ngày** → bóc link →
listing CSV → detail CSV → tải ảnh (bỏ qua bước nào chưa có dữ liệu). Kết quả ở
`csv_processed\` và `image\`.

Hoặc chạy lẻ từng script:

```powershell
python organize_pages.py         # gom .html lẻ -> crawl_manually\<ngày>\
python parse_saved_pages.py      # -> csv_processed\shopee_listing_<ngày>.csv
python extract_product_urls.py   # -> crawl_manually\<ngày>\product_urls.txt
```

### Bước 3 — Mở tab sản phẩm để lưu trang CHI TIẾT (PDP)

Mỗi **ngày cào** có danh sách link riêng ở `crawl_manually\<ngày>\product_urls.txt`.
Chọn ngày bằng `--date` (bỏ qua thì lấy ngày **mới nhất**).

**Mở lần lượt 5 tab — không trùng:** cứ chạy lặp lại **cùng một lệnh**, script
nhớ vị trí đã mở trong file `.url_cursor` (mỗi ngày một con trỏ riêng):

```powershell
python open_product_tabs.py 5      # lần 1 -> tab 1..5
python open_product_tabs.py 5      # lần 2 -> tab 6..10
python open_product_tabs.py 5      # lần 3 -> tab 11..15 ...
```

Muốn **chắc chắn** không trùng (kể cả khi bạn quên lưu vài tab), thêm
`--skip-saved`: script tự đọc các trang PDP **đã lưu** trong thư mục ngày và
chỉ mở những sản phẩm **chưa có PDP**:

```powershell
python open_product_tabs.py 5 --skip-saved --date 2026-10-15
```

**Mở tất cả một lượt** (nếu muốn):

```powershell
python open_product_tabs.py all --date 2026-10-15  # tất cả sản phẩm của 1 ngày
python open_product_tabs.py all                    # tất cả sản phẩm ngày mới nhất
python open_product_tabs.py all --all-days         # tất cả sản phẩm của MỌI ngày
```

> Danh sách quá dài thì script **tự chia thành nhiều lần mở** (không vượt giới
> hạn dòng lệnh Windows). `--all-days` gộp sản phẩm của tất cả các ngày.

Script in ra thư mục ngày cần lưu, ví dụ:
`luu vao F:\SHOPEE\crawl_manually\2026-10-15`.

Sang từng tab → **Ctrl+S → "Webpage, HTML Only"** → lưu **vào đúng thư mục ngày
in ra** → đóng tab. Chạy lại lệnh để mở tiếp.

Mở lại từ đầu (khi quên đang ở vị trí nào):

```powershell
python open_product_tabs.py --reset --date 2026-10-15
```

> Quan trọng: **lưu PDP vào đúng thư mục ngày** để sản phẩm được gán đúng
> "ngày cào" — nhờ vậy CSV/ảnh mới tách đúng theo từng ngày.

### Bước 4 — Bóc dữ liệu chi tiết + tải ảnh

Sau khi đã lưu các trang PDP:

```powershell
python run_pipeline.py
```

Kết quả (theo từng ngày):
- `csv_processed\shopee_detail_<ngày>.csv` — dữ liệu chi tiết (đủ bộ ảnh, mô tả…).
- `image\<ngày>\{id}_main.jpg` — ảnh chính từng sản phẩm.

---

## 4. Chạy nhanh bằng 1 lệnh

Mỗi lần chỉ muốn bóc toàn bộ những gì đã lưu:

```powershell
cd F:\SHOPEE\extract_data
python run_pipeline.py
```

Đây là "pipeline có sẵn" để bạn tự kiểm thử mà không cần nhờ ai.

---

## 5. Mô tả từng script

| Script | Việc | Đầu ra |
|---|---|---|
| `run_pipeline.py` | Chạy cả 5 bước dưới cùng lúc | như bên dưới |
| `organize_pages.py` | Gom `.html` lẻ vào thư mục ngày | `crawl_manually\<ngày>\*.html` |
| `extract_product_urls.py` | Bóc link PDP từ trang listing | `crawl_manually\<ngày>\product_urls.txt` |
| `open_product_tabs.py [N\|all] [--date <ngày>] [--all-days] [--skip-saved]` | Mở N tab / **tất cả** tab PDP (nhớ vị trí, không trùng) | (mở trình duyệt) |
| `parse_saved_pages.py` | Bóc trang **listing** → CSV | `csv_processed\shopee_listing_<ngày>.csv` |
| `parse_saved_products.py` | Bóc trang **chi tiết** → CSV | `csv_processed\shopee_detail_<ngày>.csv` |
| `download_saved_images.py` | Tải ảnh chính về máy | `image\<ngày>\{id}_main.jpg` |

Các script bóc dữ liệu **lặp theo từng thư mục ngày**: cào nhiều ngày thì mỗi
ngày ra 1 CSV + 1 thư mục ảnh riêng. Chạy lại nhiều lần **an toàn**
(idempotent): sản phẩm gộp và khử trùng lặp theo `id`.

---

## 6. Định dạng dữ liệu đầu ra

**CSV** gồm 19 cột giống mẫu Tiki, cộng vài cột mở rộng:

| cột | nguồn |
|---|---|
| `id` | `itemid` |
| `name` | tên sản phẩm |
| `price` / `original_price` | giá (VND) |
| `discount_rate` | % giảm (tính từ giá) |
| `rating_average` / `review_count` | điểm & số đánh giá |
| `sold_count` | số đã bán (nếu có) |
| `seller_id` / `seller_name` | shopid / tên shop |
| `brand_name` | thương hiệu |
| `category_id` | danh mục |
| `thumbnail_url` / `main_image_url` | ảnh (cf.shopee.vn) |
| `all_image_urls` | JSON danh sách ảnh (PDP: đủ bộ) |
| `url_path` | link sản phẩm |
| `created_at_snapshot` | ngày cào |
| *(mở rộng)* `shop_location`, `stock`, `liked_count`, `ctime`, `description` | HTML/JSON nhúng |
| *(mở rộng)* `rating_breakdown` | JSON phân bố sao + số review "Có bình luận / Có ảnh" |
| *(mở rộng)* `rating_5`…`rating_1` | số đánh giá theo từng mức sao (đã tách cột) |
| *(mở rộng)* `review_with_comment` / `review_with_media` | số review có bình luận / có ảnh-video |
| *(mở rộng)* `reviews` | JSON danh sách **comment** đã lưu trên trang PDP |

Cột `description` (mô tả) có **tiếng Việt, emoji, xuống dòng** đầy đủ.
Cột `reviews` là một mảng JSON, mỗi phần tử:

```json
{
  "cmtid": 107070183792,
  "user": "mhannn",
  "userid": 0,
  "rating": 5,
  "time": "2026-08-12 15:19",
  "variant": "Phân loại hàng: 3 Màu Đen,XL : 75kg-85kg",
  "attributes": {"Chất liệu": "mềm mại", "Đúng với mô tả": "giống quảng cáo"},
  "comment": "Shop giao hàng nhanh, hàng i chang hình...",
  "media": ["https://down-vn.img.susercontent.com/file/..."],
  "seller_response": "Dạ shop cảm ơn anh/chị...",
  "helpful": 1
}
```

> `rating_5`…`rating_1`: số lớn trên Shopee hiển thị rút gọn ("1,6k") nên là số
> **làm tròn** (1,6k → 1600); số nhỏ (101, 47…) thì chính xác.
>
> Lưu ý: khi Ctrl+S, Shopee chỉ render sẵn **~5-10 review đầu** (không tải
> toàn bộ review). Muốn đủ comment thì vào tab "Đánh giá" của Shopee, chờ nó
> hiện ra rồi mới Ctrl+S.

Mỗi CSV đi kèm:
- `<tên>_<ngày>_raw.json` — JSON đầy đủ.
- `<tên>_<ngày>_summary.json` — thống kê (số dòng, số file gộp…).

---

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `Khong co file .html nao trong ...crawl_manually` | Chưa lưu trang nào → làm Bước 1. |
| `Chua co ...product_urls.txt. Chay extract_product_urls.py truoc` | Chưa có link sản phẩm → chạy `extract_product_urls.py` (cần ≥1 trang listing). |
| `Chua co du lieu. Luu trang .html ... truoc` (open_product_tabs) | Chưa có thư mục ngày nào → lưu ≥1 trang listing rồi chạy `organize_pages.py`. |
| File `.html` vẫn nằm lẻ ở `crawl_manually` | Chạy `python organize_pages.py` để gom vào thư mục ngày. |
| `Khong tim thay trang chi tiet nao` | Chưa lưu trang **chi tiết** (PDP) nào → làm Bước 3. |
| `Khong tim thay chrome.exe` | Chrome cài ở vị trí lạ → đặt biến môi trường `SHOPEE_CHROME_PATH` = đường dẫn `chrome.exe`. |
| Không bóc được sản phẩm nào | Trang lưu bị thiếu (chỉ lưu khi trang chưa tải xong) → tải lại, cuộn cho hiện sản phẩm, rồi Ctrl+S. |
| Ảnh `fail` vài cái | Mạng/CDN tạm thời → chạy lại `python download_saved_images.py` (tự bỏ qua ảnh đã có). |

---

## 8. Ghi chú

- Công cụ phục vụ **học tập / nghiên cứu**; tôn trọng Điều khoản dịch vụ của Shopee.
- Chỉ đọc file cục bộ; riêng `download_saved_images.py` tải ảnh từ CDN công khai
  (`cf.shopee.vn`) với tần suất thấp.
- **Nên giữ** các file `.html` trong `crawl_manually` để có thể bóc lại bất cứ lúc nào.
