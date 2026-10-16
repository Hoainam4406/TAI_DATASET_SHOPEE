"""Pipeline boc du lieu Shopee tu cac trang da luu THU CONG bang Ctrl+S.

Toan bo qua trinh chay offline (chi doc file .html tren may), tru viec tai anh
tu CDN anh cua Shopee. Xuat du lieu ra dung dinh dang nhu mau Tiki:

- crawl_manually\\         (dau vao) file .html luu bang Ctrl+S
- csv_processed\\<ten>_<YYYY-MM-DD>.csv      (bang du lieu + _raw.json + _summary.json)
- image\\<YYYY-MM-DD>\\{id}_main.jpg|png|webp (anh main, chia theo ngay cao)
"""

__version__ = "0.2.0"
