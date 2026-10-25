# Cào chung với nhóm qua GitHub

Mọi người cùng cào bằng Chrome extension (`chrome_extension/`) và đẩy dữ liệu vào **một repo
GitHub private** của nhóm. GitHub miễn phí cho Organization, repo private và số thành viên.
Mỗi người bấm **"Đăng nhập bằng GitHub"** trên Dashboard là dùng được, không cần tự tạo token.
Dữ liệu được chia theo **keyword** và **ngày**, không cần biết ai cào:

```
ten-org/shopee-data  (repo private)
├─ README.md
├─ keywords.csv                        # danh sách keyword chung + trạng thái
└─ data/<keyword_id>/<YYYY-MM-DD>.csv  # sản phẩm của keyword đó trong ngày đó
```

- `keyword_id` = slug không dấu + 4 ký tự hash, ví dụ `tai nghe không dây` →
  `tai-nghe-khong-day-ab2d`. Viết hoa/thường hay thừa khoảng trắng vẫn ra cùng id;
  "bàn" và "bán" ra id khác nhau.
- Hai keyword không bao giờ ghi đè nhau. Cào lại cùng keyword trong cùng ngày thì file được
  thay bằng bản mới nhất. Lịch sử Git vẫn giữ bản cũ.
- `keywords.csv` có cột `status`: `todo` (chưa ai làm) → `in_progress` (đã có người nhận) →
  `done` (đã có dữ liệu). Keyword `in_progress` quá 48 giờ được trả lại cho người khác.
- Hai người bấm "Nhận keyword" cùng lúc **không bao giờ nhận trùng**: mỗi lần cập nhật là một
  commit dựa trên commit vừa đọc. Nếu nhánh vừa đổi, GitHub từ chối, extension đọc lại danh sách
  và chọn keyword khác.
- Mỗi lần đẩy dữ liệu là **một commit** gồm các file dữ liệu và `keywords.csv`.
- Tên và ID người mua trong cột `reviews` được thay bằng mã băm `u_xxxxxxxxxxxx` trước khi
  đẩy lên. Cùng một người thì cùng một mã, nên vẫn dùng được cho RecSys.

---

## Người quản lý: chuẩn bị (1 lần, khoảng 10 phút)

### 1. Organization và repo

1. github.com → góc phải **+** → *New organization* → chọn gói **Free**.
2. *New repository*: phần *Owner* chọn organization, đặt tên ví dụ `shopee-data`, chọn
   **Private**, và **tick "Add a README file"**. Repo trống (không có commit nào) thì extension
   không ghi được.
3. Mời thành viên: Organization → *People* → *Invite member*. Sau đó vào repo → *Settings* →
   *Collaborators and teams*, cấp quyền **Write**. Thành viên organization mặc định chỉ có quyền
   Read; mà đăng nhập bằng GitHub App thì quyền của mỗi người không vượt quá quyền họ có trong
   repo.

### 2. Tạo GitHub App (để có nút "Đăng nhập bằng GitHub")

Vào Organization → *Settings* → *Developer settings* → *GitHub Apps* → **New GitHub App**:

| Mục | Điền |
|---|---|
| GitHub App name | tên bất kỳ chưa ai dùng, ví dụ `TAI Shopee Crawler - ten-org` |
| Homepage URL | link repo, ví dụ `https://github.com/ten-org/shopee-data` |
| Callback URL | **để trống** |
| Expire user authorization tokens | giữ tick (extension tự làm mới token) |
| Request user authorization (OAuth) during installation | **bỏ tick** |
| **Enable Device Flow** | **tick** (bắt buộc) |
| Webhook → Active | **bỏ tick** |
| Permissions → Repository permissions → **Contents** | **Read and write** (*Metadata: Read-only* tự bật) |
| Where can this GitHub App be installed? | **Only on this account** |

Bấm **Create GitHub App**, rồi:

1. Chép **Client ID** ở trang app. Nó bắt đầu bằng `Iv…` và **không phải App ID**. Không cần
   tạo client secret hay private key.
2. Ở menu trái chọn **Install App** → *Install* vào organization → chọn
   **Only select repositories** → `shopee-data`. Nhờ vậy app chỉ đụng được đúng repo này.

### 3. Gửi cấu hình cho nhóm

Điền vào `chrome_extension/team.config.json`, rồi gửi cho nhóm cùng thư mục extension
(hoặc commit vào repo code nếu nhóm lấy extension từ đó):

```json
{
  "repo": "ten-org/shopee-data",
  "githubAppClientId": "Iv23li..."
}
```

Client ID **không phải bí mật**. **Không bao giờ** ghi token vào file này. Nếu không dùng file
này, thành viên tự dán Client ID vào mục *Cấu hình nhóm (GitHub App)* trên Dashboard.

### 4. Đưa danh sách keyword lên

Đăng nhập trên Dashboard (như thành viên, xem bên dưới), dán keyword vào ô Keyword (02) rồi bấm
**Đưa keyword ở ô 02 lên danh sách**. File `keywords.csv` sẽ được tạo. Muốn ghi nhóm/danh mục
thì sửa cột `group` trực tiếp trên GitHub.

---

## Thành viên: đăng nhập, cào và đẩy dữ liệu

1. Nhận lời mời vào organization (qua email hoặc github.com) và **đăng nhập github.com trên
   Chrome**.
2. `chrome://extensions` → **↻ Reload** extension → mở Dashboard → mục **04 Cào chung (GitHub)**.
   Ô repo đã điền sẵn (nếu người quản lý điền `team.config.json`).
3. Bấm **Đăng nhập bằng GitHub**:
   - Dashboard hiện một mã, ví dụ `WDJB-MJHT`, và tự chép mã vào bộ nhớ.
   - Bấm **Mở trang nhập mã** → dán mã → **Continue** → **Authorize**. Lần đầu GitHub hiện quyền
     của app: chỉ đọc/ghi nội dung các repo đã cài app.
   - Quay lại Dashboard: tự hiện "Đã kết nối: <tên GitHub của bạn>".
4. Bấm **Nhận keyword** (chọn số lượng). Các keyword được điền vào ô Keyword, bấm
   **Bắt đầu cào**.
5. Khi cào xong:
   - Nếu tick **Tự đẩy lên khi cào xong**, dữ liệu tự lên repo.
   - Nếu không, chọn ngày và bấm **Đẩy lên GitHub**.

   Keyword đã đẩy được đánh dấu `done`.

Phiên đăng nhập tự gia hạn: token sống 8 giờ và được tự làm mới. Chỉ cần đăng nhập lại nếu
khoảng 6 tháng không dùng, hoặc sau khi bấm **Đăng xuất**.

| Lỗi | Cách xử lý |
|---|---|
| "Thiếu Client ID" | Dán Client ID vào *Cấu hình nhóm (GitHub App)*, hoặc nhờ người quản lý điền `team.config.json`. |
| "Client ID không đúng" | Đang dán **App ID** (dạng số), cần **Client ID** (dạng `Iv…`). |
| "chưa bật Device Flow" | Người quản lý tick *Enable Device Flow* trong cài đặt app. |
| 404 / 403 sau khi đăng nhập | App chưa được *Install* vào repo này, hoặc bạn chưa có quyền **Write** trong repo. |
| "Phiên đăng nhập hết hạn" / 401 | Bấm **Đăng xuất** rồi đăng nhập lại. |
| "repo đang trống" | Repo chưa có commit nào → thêm README trên GitHub. |

### Dự phòng: dùng token thay cho đăng nhập

Nếu chưa có GitHub App, mở mục **Dùng token thay cho đăng nhập** trên Dashboard và dán một
fine-grained token: github.com → *Settings* → *Developer settings* → *Personal access tokens* →
*Fine-grained tokens* → *Resource owner* = organization, *Only select repositories* →
`shopee-data`, quyền **Contents: Read and write**. Organization phải cho phép fine-grained token:
*Settings* → *Third-party Access* → *Personal access tokens*.

---

## Gộp dữ liệu cuối

```bash
git clone https://github.com/ten-org/shopee-data
```
```bash
pip install -r team_dataset/requirements.txt
```
```bash
python team_dataset/build_dataset.py shopee-data
```

Các lần sau chỉ cần `git -C shopee-data pull` rồi chạy lại lệnh cuối. Kết quả nằm trong
`team_dataset/build/`. Thêm `--csv` nếu không muốn cài `pyarrow`.

| Bảng | Nội dung |
|---|---|
| `products` | 1 dòng / sản phẩm, bản cào mới nhất (ưu tiên bản có trang chi tiết) |
| `product_keywords` | `id, keyword_id, keyword, crawl_date, search_page, search_rank`: sản phẩm ↔ keyword |
| `history` | giá, đã bán, điểm, số đánh giá của từng sản phẩm theo ngày |
| `reviews` | 1 dòng / đánh giá (`cmtid`), người mua đã ẩn danh |

## Lưu ý

- Mỗi file khoảng 0,15 MB với số lượng mặc định (20 sản phẩm / keyword). GitHub chặn file trên
  100 MB và khuyên repo dưới 1–5 GB, nên dư sức cho dữ liệu CSV của nhóm.
- Mỗi người có 5.000 lượt gọi API / giờ. Mỗi lần nhận hoặc đẩy chỉ tốn vài lượt.
- Thông tin đăng nhập chỉ lưu trong Chrome của từng người, không ghi ra file. Tài khoản và mật
  khẩu GitHub không bao giờ nhập vào extension.
- Dữ liệu cào từ Shopee chỉ nên dùng cho học tập / nghiên cứu. Giữ repo ở chế độ **private**.
