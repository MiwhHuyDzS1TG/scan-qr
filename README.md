# Attendance Control Center

Dashboard quản trị điểm danh QR dùng FastAPI và Vanilla JavaScript. QR, cookie trường và CSRF upstream chỉ được xử lý ở backend; frontend chỉ nhận alias thành viên và response đã làm sạch.

## Quy tắc nghiệp vụ

- `HTTP 200` không tự động có nghĩa là điểm danh thành công.
- `success=false`, `attendance_status=present` và thông báo đã điểm danh được chuẩn hóa thành `already_present`, không phải lỗi và không phải lượt điểm danh mới.
- `success=true` chỉ trở thành `success` khi response không mâu thuẫn và danh tính trả về phù hợp metadata kỳ vọng.
- Timeout, mất kết nối, JSON lỗi, body rỗng hoặc response mâu thuẫn trở thành `unknown`. Ứng dụng không tự retry POST.
- `requested_at`, `response_received_at` và `scanned_at_iso` được giữ riêng; UI dùng thời gian máy chủ xác nhận.
- `is_simulation=true` luôn làm `verified_present=false` và không được tính vào KPI thực tế.

## Thành viên được quản lý

Nguồn QR phải chứa chính xác sáu alias sau: `MinhHuy`, `HoangPhong`, `GiaLam`, `MinhKhang`, `NgocDuc`, `KimNgan`. Ứng dụng fail closed nếu thiếu alias, có alias thừa hoặc có QR trùng. Mã QR thật không nằm trong tài liệu, frontend hoặc bundle Vercel.

Thứ tự nguồn dữ liệu backend:

1. `QR_DATA_JSON` nếu có giá trị.
2. File tại `QR_DATA_FILE` nếu biến này được đặt.
3. `qr_data.json` trong project root.

Vì biến môi trường có ưu tiên cao nhất, không để một `QR_DATA_JSON` cũ trên Vercel. Validation chính xác sáu alias sẽ ngăn cấu hình cũ hoặc dữ liệu mẫu khởi động âm thầm.

## Chạy local

Python 3.12 được dùng để đồng bộ với Vercel:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Chuẩn bị cấu hình riêng tư:

1. Đặt `APP_ENV=development` trong `.env`.
2. Chọn `ADMIN_USERNAME` riêng.
3. Chạy `python scripts/hash_password.py`, nhập mật khẩu mạnh và đặt kết quả vào `ADMIN_PASSWORD_HASH`.
4. Chạy `python -c "import secrets; print(secrets.token_urlsafe(48))"` và đặt kết quả vào `SESSION_SECRET`.
5. Tạo `qr_data.json` riêng tư theo cấu trúc `data/qr_data.example.json`, thay toàn bộ mã giả bằng dữ liệu được cấp. Để `QR_DATA_JSON` trống khi muốn dùng file local.
6. Điền bốn cookie upstream nếu cần kiểm tra/quét thật.

Khởi động:

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Mở `http://127.0.0.1:8000` và đăng nhập bằng tài khoản vừa cấu hình. Không có tài khoản hay mật khẩu mặc định. Trang không gọi upstream khi tải; bấm chip trạng thái nếu muốn thực hiện GET kiểm tra phiên. POST điểm danh chỉ xảy ra sau khi đăng nhập, chọn thành viên và xác nhận modal.

## Environment Variables

| Biến | Production | Mô tả |
|---|---:|---|
| `APP_ENV` | Bắt buộc | Dùng `production` trên Vercel; local dùng `development`; `test` chỉ dành cho test tự động. |
| `BASE_URL` | Bắt buộc | HTTPS origin của máy chủ trường. |
| `ADMIN_USERNAME` | Bắt buộc | Tài khoản quản trị, không có giá trị mặc định. |
| `ADMIN_PASSWORD_HASH` | Bắt buộc | Hash scrypt hợp lệ tạo bằng script. Production từ chối mật khẩu mặc định không an toàn. |
| `SESSION_SECRET` | Bắt buộc | Chuỗi ngẫu nhiên tối thiểu 32 ký tự, không dùng placeholder. |
| `SESSION_TTL_SECONDS` | Không | Mặc định 28.800 giây, cho phép 900 đến 86.400. |
| `QR_DATA_JSON` | Bắt buộc trên Vercel | JSON object riêng tư chứa đúng sáu alias. |
| `QR_DATA_FILE` | Không | Đường dẫn file QR riêng tư local; mặc định `qr_data.json`. |
| `MEMBER_METADATA_JSON` | Không | Tên/lớp/STT kỳ vọng để phát hiện mismatch danh tính. |
| `CF_CLEARANCE` | Bắt buộc | Cookie upstream phía server. |
| `LARAVEL_SESSION` | Bắt buộc | Cookie upstream phía server. |
| `REMEMBER_WEB` | Bắt buộc | Cookie upstream phía server. |
| `XSRF_TOKEN` | Bắt buộc | Cookie upstream phía server. |

Production không khởi động nếu thiếu tài khoản, hash, session secret, cookie upstream hoặc mapping sáu người. Không commit `.env`, `qr_data.json`, cookie hay secret.

## Sử dụng dashboard

1. Đăng nhập bằng tài khoản quản trị đã cấu hình.
2. Kiểm tra danh sách có đủ sáu alias. Có thể tìm kiếm, lọc và chọn riêng từng người.
3. Chọn tất cả để nút hiển thị `Quét 6 thành viên`, hoặc chọn một/nhiều người tùy nhu cầu.
4. Đọc modal và bấm xác nhận. Queue xử lý tuần tự với concurrency bằng 1.
5. Theo dõi progress, badge trạng thái và Live terminal. Nút dừng chỉ ngăn người kế tiếp; request đang chạy vẫn được chờ hoàn tất.
6. Mở drawer để xem response đã làm sạch, danh tính và giờ máy chủ; dùng CSV export để tải tổng kết.
7. Nếu session ứng dụng hết hạn, đăng nhập lại. Nếu phiên trường hết hạn/HTTP 419, cập nhật cookie qua quy trình được nhà trường cho phép rồi kiểm tra lại kết nối.

## API nội bộ

- `GET /api/auth/session`: tạo pre-auth CSRF hoặc trả session hiện tại.
- `POST /api/auth/login`: xác thực quản trị và áp dụng rate limit.
- `POST /api/auth/logout`: yêu cầu session và CSRF.
- `GET /api/members`: không trả QR.
- `POST /api/scan`: nhận `member_id`, `batch_id`, `request_id`; backend tra QR và gửi tối đa một POST cho lượt xử lý.
- `GET /api/health?probe=false`: chỉ báo cấu hình, không gọi upstream.
- `GET /api/health?probe=true`: GET trang điểm danh để kiểm tra CSRF/session, không gửi điểm danh.
- `GET /api/avatar?path=...`: chỉ proxy đường dẫn `/storage/avatars/` từ `BASE_URL` tin cậy.

## Tests an toàn

```powershell
python -m pytest
npm test
npm run check
```

Test dùng QR/cookie giả và mocked upstream. Không có test hay build nào gửi POST tới máy chủ trường. Fixture response đã quan sát chỉ khóa logic normalize.

Browser QA dùng app test-only tại `tests/browser_app.py` và biến `QA_USERNAME`/`QA_PASSWORD`; không chạy `main:app` với cookie thật cho bài test quét giao diện. Ảnh QA `tests/qa-*.png` đã bị Git ignore.

## Deploy Vercel

Project dùng `.python-version` 3.12, FastAPI entrypoint `main.py`, static assets trong `public/`, và `vercel.json` đặt `maxDuration=60`. Không cần Build Command tùy chỉnh.

Tài liệu Vercel được đối chiếu ngày 17/11/2026:

- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
- [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)

Cấu hình CLI:

```powershell
vercel login
vercel link
vercel env add APP_ENV production
vercel env add BASE_URL production
vercel env add ADMIN_USERNAME production
vercel env add ADMIN_PASSWORD_HASH production
vercel env add SESSION_SECRET production
vercel env add SESSION_TTL_SECONDS production
vercel env add QR_DATA_JSON production
vercel env add MEMBER_METADATA_JSON production
vercel env add CF_CLEARANCE production
vercel env add LARAVEL_SESSION production
vercel env add REMEMBER_WEB production
vercel env add XSRF_TOKEN production
vercel pull --yes --environment=production
vercel build
vercel --prod
```

Trước deploy, kiểm tra `QR_DATA_JSON` Production chứa đúng sáu alias và xóa/ghi đè giá trị cũ. Không dùng Preview values thay cho Production values. Nếu CLI chưa đăng nhập thì dừng ở `vercel login`; không coi đó là deploy thành công.

## Xác minh production an toàn

1. Truy cập `/`, đăng nhập và xác nhận CSS/JS tải bình thường.
2. Xác nhận `/api/members` chỉ có sáu alias và không có QR.
3. Bấm chip trạng thái để chạy GET kiểm tra session; không có POST ở bước này.
4. Chỉ khi được ủy quyền, chọn đúng một thành viên thử nghiệm, đọc modal rồi xác nhận.
5. So sánh tên, lớp, STT và `scanned_at_iso` trong drawer với hệ thống trường.
6. Với `unknown`, xác minh thủ công trước khi tạo lượt mới; ứng dụng không retry.
7. Nếu upstream từ chối Vercel IP/session, dùng cơ chế API/xác thực được nhà trường cho phép, không vượt Cloudflare.

## Bảo mật và giới hạn

- Session dùng cookie HttpOnly, Secure trên Production, SameSite Strict, có expiration và CSRF riêng.
- QR lookup, cookie và upstream CSRF chỉ ở server; log không chứa dữ liệu này.
- Mỗi scan tạo `requests.Session` riêng, GET CSRF rồi POST đúng một lần và đóng session trong `finally`.
- Queue là snapshot tuần tự trong một tab; double-click bị chặn.
- `request_id` cache và rate limit hiện chỉ tồn tại trong memory của một Vercel Function instance. Chúng không chống trùng tuyệt đối giữa nhiều instance, tab, thiết bị hoặc region.
- Signed session hiện không có danh sách thu hồi dùng chung. Logout xóa cookie trình duyệt nhưng một token bị sao chép vẫn hợp lệ đến khi hết hạn.
- Live log chỉ tồn tại trong tab hiện tại.

Muốn idempotency/rate limit/session invalidation toàn cục cần datastore chia sẻ như Postgres hoặc Redis/KV, unique constraint theo request/member/batch và server-side session/revocation store.

## Troubleshooting

- **Ứng dụng không khởi động**: đọc tên biến thiếu trong lỗi cấu hình; không in giá trị secret.
- **QR source sai**: xóa `QR_DATA_JSON` mẫu/cũ hoặc cập nhật đủ đúng sáu alias; biến này luôn ưu tiên hơn file.
- **Phiên trường hết hạn / HTTP 419**: cập nhật cookie hợp lệ rồi bấm kiểm tra kết nối.
- **Redirect về login**: app không follow redirect và không POST lại.
- **Không tìm thấy CSRF**: POST không được gửi.
- **Timeout / network failure**: kết quả là `unknown`, không tự retry.
- **Avatar lỗi**: UI dùng initials; URL ngoài trusted origin bị từ chối.
- **Vercel timeout**: xem function logs và upstream latency; không tăng timeout để che lỗi session/xác thực.
