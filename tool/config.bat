@echo off
REM ============================================================
REM Cau hinh mac dinh cho tool copy report.
REM Khi chay 03-install-schedule.bat, script se hoi lai tung gia tri
REM (Enter = giu mac dinh) va ghi file config.bat moi vao C:\BatchReportTool
REM ============================================================

REM Thu muc tren may san xuat chua file PDF report
set "SOURCE_DIR=D:\BatchReports"

REM Thu muc goc tren NAS (phai trung voi thu muc worker doc - REPORT_ROOT_DIR / NAS_SHARE)
REM Moi may se copy vao 1 thu muc con rieng: NAS_ROOT\MACHINE_NAME
set "NAS_ROOT=\\10.1.11.8\Share Folder\BATCH REPORT"

REM Ten thu muc con cua may nay tren NAS (mac dinh = ten may tinh)
set "MACHINE_NAME=%COMPUTERNAME%"
