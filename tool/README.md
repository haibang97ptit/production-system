# Tool copy report từ máy sản xuất lên NAS

| File | Vai trò |
|---|---|
| `03-install-schedule.bat` | **Chạy 1 lần trên mỗi máy** để cài đặt (gọi `install.ps1`) |
| `config.bat` | Giá trị mặc định (thư mục PDF, thư mục NAS) — sửa trước khi mang đi cài nếu cần |
| `02-copy-report.bat` | Script copy, Task Scheduler gọi 5 phút một lần |
| `run-hidden.vbs` | Chạy script copy ẩn, không bật cửa sổ CMD (chế độ USER) |
| `04-uninstall.bat` | Gỡ tool |

## Cài đặt trên 1 máy

1. Copy cả thư mục `tool/` sang máy (USB / share).
2. Máy có quyền admin: **chuột phải `03-install-schedule.bat` → Run as administrator**.
   Máy không có admin: double-click bình thường.
3. Nhập theo hướng dẫn: thư mục PDF, thư mục NAS, tên máy, user/mật khẩu NAS.
4. Script tự chạy thử 1 lần và báo kết quả.

Tool được cài vào `C:\BatchReportTool`, file sẽ copy lên `NAS_ROOT\<TÊN_MÁY>\`.

## Hai chế độ chạy

| | SYSTEM (có admin) | USER (không admin) |
|---|---|---|
| Chạy khi không ai đăng nhập / sau reboot | Có | Không — chỉ khi user đó đang đăng nhập |
| Tài khoản NAS lưu ở | Credential Manager của SYSTEM | Credential Manager của user đó |
| Operator xem/xóa được tài khoản | Không | Có (trong Credential Manager) |

Ở cả hai chế độ, tài khoản lưu bằng `cmdkey` (Windows mã hóa DPAPI) và **còn mãi qua reboot**. Đổi mật khẩu NAS → chạy lại `03-install-schedule.bat`.

## Theo dõi

- Trên máy: `C:\BatchReportTool\logs\copy-report.log` (tóm tắt), `robocopy-last.log` (chi tiết lần chạy cuối)
- Tập trung trên NAS: `NAS_ROOT\_status\<TÊN_MÁY>.txt` — thời gian chạy cuối + kết quả của từng máy
- Mã lỗi task: `0` OK, `1` robocopy lỗi, `2` không thấy thư mục PDF, `3` không vào được NAS

## Lỗi thường gặp

- **Mã 3 ở chế độ USER dù đúng mật khẩu**: user đang mở NAS bằng tài khoản khác (Explorer / ổ mạng đã map). Windows không cho dùng 2 tài khoản tới cùng 1 NAS cùng lúc → đăng xuất hoặc khởi động lại máy.
- **Kiểm tra tài khoản đã lưu (USER)**: `cmdkey /list`
- **Chạy tay để thử**: `schtasks /run /tn CopyMachineReport`
