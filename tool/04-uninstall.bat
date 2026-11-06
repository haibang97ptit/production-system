@echo off
REM ============================================================
REM Go tool copy report khoi may (task + thu muc C:\BatchReportTool).
REM Chay bang "Run as administrator" neu luc cai dung che do SYSTEM.
REM Tai khoan NAS da luu KHONG bi xoa tu dong - xem huong dan cuoi man hinh.
REM ============================================================
schtasks /delete /tn "CopyMachineReport" /f
if exist "C:\BatchReportTool\" rmdir /s /q "C:\BatchReportTool"
echo.
echo Da go task va thu muc tool.
echo.
echo Neu muon xoa ca tai khoan NAS da luu:
echo   - Che do USER  : cmdkey /delete:10.1.11.8
echo   - Che do SYSTEM: schtasks /create /tn tmpdel /tr "cmdkey /delete:10.1.11.8" /sc once /st 00:00 /ru SYSTEM /f
echo                    schtasks /run /tn tmpdel   ^&   schtasks /delete /tn tmpdel /f
echo.
pause
