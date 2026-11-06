@echo off
REM ============================================================
REM Cai dat tool copy report len NAS - chay 1 lan tren moi may san xuat.
REM
REM   Chuot phai -> "Run as administrator" (khuyen nghi neu co quyen admin):
REM       task chay ngam bang SYSTEM, khong can ai dang nhap.
REM   Double-click binh thuong (khong co quyen admin):
REM       task chay khi user hien tai dang dang nhap.
REM
REM Script se hoi: thu muc PDF, thu muc NAS, ten may, user/mat khau NAS.
REM Doi mat khau NAS sau nay -> chi can chay lai file nay.
REM ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
