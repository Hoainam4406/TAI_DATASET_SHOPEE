# Shopee Crawler — Chrome extension

Tự động hoá toàn bộ pipeline trong `extract_data/`:

1. **Tìm keyword** trên Shopee (nhiều keyword, nhiều trang kết quả).
2. **Mở từng trang sản phẩm** (PDP), cuộn tới phần đánh giá để Shopee render comment.
3. **Lưu HTML** vào đúng thư mục dự án: `crawl_manually/<YYYY-MM-DD>/`.
4. **Xử lý dữ liệu** ngay trong extension (cùng logic với các script Python, đã kiểm
   khớp 100%) → `csv_processed/` + tải ảnh vào `image/<YYYY-MM-DD>/`.

Extension chạy trong **Chrome thường của bạn** (dùng tài khoản đang đăng nhập), không
dùng CDP/debugger. Gặp trang đăng nhập/xác minh thì nó **tạm dừng và báo bạn tự xử lý**,
xong sẽ tự chạy tiếp.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
2. **Load unpacked** → chọn thư mục `TAI_DATASET_SHOPEE\chrome_extension`.
3. Ghim icon kính lúp màu cam lên thanh công cụ. Bấm vào để mở **Dashboard**.

Cần Chrome 122 trở lên.

## Sử dụng

1. Mở `https://shopee.vn` và **đăng nhập** trước (để Shopee ít đòi xác minh).
2. Trên Dashboard:
   - **Chọn thư mục…** → chọn thư mục gốc `TAI_DATASET_SHOPEE`. Chrome hỏi quyền ghi,
     bấm *Cho phép* (nên chọn "Cho phép mỗi lần truy cập" nếu có).
   - Nhập **keyword** (mỗi dòng 1 cái), số trang kết quả, số sản phẩm cần mở cho mỗi keyword.
     Tick **Tất cả** để lấy hết: mọi trang kết quả mà Shopee hiển thị (thường tối đa 17 trang,
     khoảng 60 sản phẩm/trang) và/hoặc mọi sản phẩm tìm thấy. Chạy toàn bộ có thể mất nhiều giờ.
   - Bấm **Bắt đầu cào**.
3. Extension mở **một cửa sổ Shopee riêng** và tự điều khiển nó. Trong lúc chạy:
   - Cửa sổ đó phải **hiện trên màn hình**: không thu nhỏ, không bị che kín, không khóa máy
     hay để màn hình tắt, không chuyển sang tab khác trong cửa sổ đó (bị ẩn thì Shopee không
     tải sản phẩm/ảnh/đánh giá). Không cần bấm vào nó, bị che một phần vẫn được, bạn vẫn dùng
     các cửa sổ khác bình thường.
   - Nếu cửa sổ bị ẩn, extension **tự tạm dừng** (không lưu trang thiếu), hiện thông báo
     "Cửa sổ Shopee đang bị ẩn" và **tự chạy tiếp** khi cửa sổ hiện lại, không cần bấm gì.
     Bấm vào thông báo để đưa cửa sổ Shopee lên.
   - Giữ tab Dashboard mở (đóng nó là job dừng; mở lại bấm **Tiếp tục job**).
   - Khi Shopee đòi **captcha / đăng nhập** (chuyển sang trang `/verify/`, trang đăng nhập,
     hoặc hiện khung captcha ngay trên trang), extension tạm dừng và:
     **chuông kêu liên tục** (3 tiếng bíp mỗi ~2,5 giây) cho tới khi bạn giải xong, thông báo
     Windows **đứng yên** trên màn hình (bấm vào để mở cửa sổ Shopee), thanh đỏ trên Dashboard
     và tiêu đề tab nhấp nháy "(!) CẦN GIẢI CAPTCHA". Giải xong là chuông tắt và tự chạy tiếp.
     Đang ngồi ở máy thì bấm **Tắt chuông** trên thanh đỏ (hoặc Tạm dừng).
   - Chuông bật/tắt ở ô *Chuông báo liên tục…*; bấm **Thử chuông** để nghe thử. Chrome chỉ cho
     phát âm thanh sau khi bạn đã bấm vào Dashboard (nút Bắt đầu / Tiếp tục job đã tính), và
     loa máy phải đang bật.
4. Khi xong, extension tự bóc dữ liệu, ghi CSV và tải ảnh.

**Tạm dừng / Dừng / Tiếp tục job**: tiến độ được lưu sau từng trang, nên dừng giữa
chừng (kể cả tắt máy) xong vẫn chạy tiếp được từ chỗ dừng. Sản phẩm nào đã có
`pdp_*_<itemid>.html` trong ngày thì được bỏ qua.

**Xử lý dữ liệu** (mục 3 trên Dashboard): bóc lại toàn bộ `.html` của một ngày, kể cả
file bạn tự lưu bằng Ctrl+S. Không cần cài Python.

## Cào chung với nhóm (GitHub)

Mục **04 Cào chung (GitHub)** trên Dashboard cho phép nhận keyword chưa ai làm từ danh sách chung
và đẩy dữ liệu lên `data/<keyword_id>/<ngày>.csv` của một repo GitHub private (tên người mua được
ẩn danh trước khi đẩy). Mỗi người bấm **Đăng nhập bằng GitHub** (hoặc dán token dự phòng). Cách tạo repo, GitHub App và quy trình cho cả nhóm xem
[team_dataset/README.md](../team_dataset/README.md).

## Đầu ra

```
TAI_DATASET_SHOPEE\
├─ crawl_manually\<ngày>\
│   ├─ search_<keyword>_p01_<giờ>.html  # trang kết quả tìm kiếm (đã cuộn hết), giờ = lúc chụp
│   ├─ pdp_<shopid>_<itemid>.html    # trang chi tiết sản phẩm (có ghi kèm keyword đã tìm ra nó)
│   └─ product_urls.txt
├─ csv_processed\
│   ├─ keywords\<keyword_id>\
│   │   ├─ <ngày>.csv                # ★ DỮ LIỆU CUỐI (final) TÁCH THEO KEYWORD
│   │   ├─ <ngày>_listing.csv        # listing của keyword đó
│   │   ├─ <ngày>_detail.csv         # detail của keyword đó
│   │   └─ …_raw.json, …_summary.json  # kèm theo từng CSV ở trên
│   ├─ shopee_final_<ngày>.csv       # ★ dữ liệu cuối của CẢ NGÀY (kèm _raw.json, _summary.json)
│   ├─ shopee_listing_<ngày>.csv     # mọi sản phẩm thấy trên trang tìm kiếm
│   └─ shopee_detail_<ngày>.csv      # sản phẩm có trang chi tiết (giống Python)
└─ image\<ngày>\<id>_main.jpg
```

**Tách theo keyword:** cào 5 keyword thì có 5 thư mục trong `csv_processed\keywords\`, ví dụ
`tai-nghe-khong-day-ab2d\2026-10-23.csv` (tên thư mục = slug không dấu + 4 ký tự hash, giống hệt
cấu trúc `data\` trên repo GitHub của nhóm). Mỗi ngày cào thêm một file trong cùng thư mục.
Sản phẩm xuất hiện ở nhiều keyword thì có mặt trong **từng** thư mục, với `search_page` /
`search_rank` của chính keyword đó.

Mỗi thư mục keyword có 3 loại file cho mỗi ngày, mỗi loại kèm `_raw.json` và `_summary.json`:

| file | gồm sản phẩm nào |
|---|---|
| `<ngày>.csv` (final) | listing + chi tiết gộp theo `id`, có cột `has_detail` (giống file trên GitHub) |
| `<ngày>_listing.csv` | sản phẩm thấy trên trang tìm kiếm của keyword này (cột như `shopee_listing`) |
| `<ngày>_detail.csv` | sản phẩm của keyword này có trang chi tiết (cột như `shopee_detail`) |

Cả 3 file đều có thêm `keyword`, `keyword_id`, `search_page`, `search_rank`. Đẩy lên GitHub vẫn
chỉ đẩy file final. File HTML trong `crawl_manually\<ngày>\` vẫn để chung một
thư mục ngày, vì một trang sản phẩm có thể thuộc nhiều keyword, và pipeline Python cũng đọc
theo thư mục ngày.

**Cào lại cùng keyword trong ngày:** trang tìm kiếm mới **không ghi đè** trang cũ (tên file có
giờ chụp). Khi xử lý, bản mới nhất quyết định thứ hạng; sản phẩm chỉ có trong bản cũ vẫn giữ
keyword. Mỗi trang chi tiết cũng ghi kèm keyword, trang và thứ hạng lúc được mở, nên sản phẩm
không bao giờ mất keyword. (Dữ liệu cào trước bản cập nhật này thì không có thông tin đó.)

**Đủ ~60 sản phẩm / trang:** Shopee nạp đợt sản phẩm cuối khá chậm. Nếu tới cuối trang mà chưa
đủ 60 thẻ và chưa phải trang cuối, extension cuộn lên-xuống lại tối đa 4 lần để chờ.
Vẫn thiếu (hoặc còn thẻ chưa hiện) thì tải lại trang tối đa N lần (ô "Tải lại trang tìm kiếm
thiếu thẻ", mặc định 4) và giữ bản có nhiều thẻ nhất. Tải lại mà ra đúng số thẻ như lần trước
thì coi đó là số thẻ thật của trang và dừng tải lại. Trang vẫn được lưu dù ít hơn 60 thẻ (có
trang thật sự chỉ có 59 sản phẩm); log ghi rõ số thẻ.

`shopee_final_<ngày>.csv` gộp listing với chi tiết theo `id` (chi tiết được ưu tiên;
giá gốc / % giảm lấy từ listing vì trang chi tiết không có). Ngoài các cột của
`shopee_detail` (xem README gốc, mục 6), file này có thêm:

| cột | ý nghĩa |
|---|---|
| `keyword` | keyword tìm ra sản phẩm (nhiều keyword thì cách nhau bằng `\|`) |
| `search_page` / `search_rank` | trang kết quả và thứ hạng trong trang |
| `has_detail` | `1` nếu đã có trang chi tiết (mô tả, đủ ảnh, đánh giá…) |

Các file HTML vẫn tương thích với `extract_data/run_pipeline.py`.

### Chế độ không chọn thư mục

Nếu không chọn thư mục (hoặc không cấp quyền), file được tải vào
`Downloads\SHOPEE\...` với cùng cấu trúc thư mục như trên. Muốn dùng chế độ này thì tắt
"Hỏi vị trí lưu trước khi tải" trong cài đặt Chrome, nếu không Chrome sẽ hỏi lại cho
từng file.

## Tốc độ và giới hạn

- Mặc định nghỉ ngẫu nhiên 4–9 giây giữa hai lần mở trang, cứ 25 trang thì nghỉ dài
  45–90 giây. Chỉnh trong mục *Tốc độ*. Chạy nhanh quá thì Shopee đòi xác minh nhiều hơn.
- Mỗi trang chi tiết chỉ có khoảng 5–10 đánh giá đầu (Shopee chỉ render chừng đó).
- **Ảnh lazy-load:** trước khi lưu trang, extension cuộn lại tới từng ảnh thẻ sản phẩm /
  ảnh trong đánh giá chưa tải và chờ (tối đa *Chờ ảnh tải tối đa*, mặc định 15 giây/trang).
  Ảnh vẫn chưa tải kịp thì log báo `CHÚ Ý`. Ảnh chính ở listing luôn lấy từ `image_ids`
  trong link thẻ nên không bị mất hay lấy nhầm badge. Khi tải ảnh về máy, mỗi ảnh được thử
  lại tối đa 3 lần trên 2 máy chủ CDN, và chỉ lưu khi nội dung đúng là ảnh.
  Lazy-load chỉ chạy khi cửa sổ Shopee đang hiện trên màn hình; khi cửa sổ bị ẩn, extension tự
  tạm dừng như mô tả ở trên.
- Bộ bóc dữ liệu dựa vào cấu trúc HTML hiện tại của Shopee (class CSS, ld+json). Nếu
  Shopee đổi giao diện thì sửa `lib/parser.js` (và script Python tương ứng).
- Chỉ dùng cho học tập/nghiên cứu, tôn trọng Điều khoản dịch vụ của Shopee.

## Cho dev

```
chrome_extension\
├─ manifest.json, background.js        # bấm icon → mở Dashboard
├─ dashboard.html / .css / .js         # giao diện + điều khiển
├─ lib\crawler.js                      # điều phối: search → PDP → xử lý → ảnh
├─ lib\pagescripts.js                  # chạy trong tab Shopee: chờ, cuộn, lấy HTML
├─ lib\parser.js                       # port 1:1 parser Python (thuần JS)
├─ lib\pipeline.js                     # gộp listing/detail/final, xuất CSV
├─ lib\fsstore.js, lib\db.js           # ghi thư mục dự án / IndexedDB
└─ tools\process_folder.mjs, test\     # chạy bằng Node
```

```bash
cd chrome_extension
node --test                                  # test parser + dữ liệu mẫu
node tools/process_folder.mjs 2026-10-21     # xử lý lại 1 ngày bằng Node
```
