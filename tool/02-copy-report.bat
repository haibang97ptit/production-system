@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM ============================================================
REM Copy file bao cao (.pdf) tu may san xuat len NAS.
REM Task Scheduler goi script nay moi 5 phut (cai bang 03-install-schedule.bat).
REM
REM Exit code: 0 = OK, 1 = robocopy loi, 2 = thieu thu muc nguon,
REM            3 = khong vao duoc NAS (mat mang / sai tai khoan)
REM Log: logs\copy-report.log (tom tat) va logs\robocopy-last.log (chi tiet lan chay cuoi)
REM ============================================================

call "%~dp0config.bat"
if not defined MACHINE_NAME set "MACHINE_NAME=%COMPUTERNAME%"

REM Bo dau \ o cuoi duong dan (robocopy hieu sai "D:\abc\")
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
if "%NAS_ROOT:~-1%"=="\" set "NAS_ROOT=%NAS_ROOT:~0,-1%"

set "DEST=%NAS_ROOT%\%MACHINE_NAME%"
set "LOG_DIR=%~dp0logs"
set "LOG=%LOG_DIR%\copy-report.log"
set "ROBOLOG=%LOG_DIR%\robocopy-last.log"

if not exist "%LOG_DIR%\" mkdir "%LOG_DIR%"

REM Xoay vong log khi lon hon 5 MB (giu lai 1 file .old)
if exist "%LOG%" for %%F in ("%LOG%") do if %%~zF GTR 5242880 move /y "%LOG%" "%LOG%.old" >nul

REM --- Kiem tra thu muc nguon ---
if exist "%SOURCE_DIR%\" goto :source_ok
call :log ERROR "Khong tim thay thu muc nguon: %SOURCE_DIR%"
exit /b 2
:source_ok

REM --- Kiem tra truy cap NAS (dung tai khoan da luu bang cmdkey cua user dang chay task) ---
if exist "%NAS_ROOT%\" goto :nas_ok
call :log ERROR "Khong vao duoc NAS: %NAS_ROOT% - kiem tra mang, hoac tai khoan da luu cho user [%USERNAME%] (cmdkey /list)"
exit /b 3
:nas_ok

REM --- Copy ---
REM /S        : copy ca thu muc con (bo qua thu muc rong)
REM /FFT      : so sanh thoi gian theo 2 giay - tranh copy lai lien tuc khi dich la NAS
REM /DCOPY:T  : giu thoi gian cua thu muc
REM /R:2 /W:10: file dang bi may ghi do (bi khoa) -> thu lai 2 lan, lan chay sau se lay tiep
REM /XJ       : bo qua junction, tranh vong lap
REM /NP /NDL  : log gon, khong in % tien do va ten thu muc
robocopy "%SOURCE_DIR%" "%DEST%" *.pdf /S /FFT /DCOPY:T /R:2 /W:10 /XJ /NP /NDL /LOG:"%ROBOLOG%" >nul
set "RC=%ERRORLEVEL%"

REM robocopy: 0 = khong co gi moi, 1-7 = thanh cong (co copy/co khac biet), >= 8 = loi
if %RC% GEQ 8 goto :robo_fail
if %RC% EQU 0 (set "MSG=Khong co file moi") else (set "MSG=Da copy file moi/thay doi")
call :log INFO "%MSG% - robocopy rc=%RC%"
call :status OK %RC%
exit /b 0

:robo_fail
call :log ERROR "robocopy loi rc=%RC% - xem chi tiet trong %ROBOLOG%"
call :status FAIL %RC%
exit /b 1

REM ============================================================
:log
>>"%LOG%" echo %DATE% %TIME% [%~1] %~2
exit /b 0

REM Ghi file trang thai len NAS (NAS_ROOT\_status\<MACHINE_NAME>.txt)
REM de IT xem 1 cho la biet may nao con copy, may nao da dung.
:status
set "STATUS_DIR=%NAS_ROOT%\_status"
if not exist "%STATUS_DIR%\" mkdir "%STATUS_DIR%" 2>nul
set "STATUS_FILE=%STATUS_DIR%\%MACHINE_NAME%.txt"
2>nul >"%STATUS_FILE%" echo machine=%MACHINE_NAME%
if not exist "%STATUS_FILE%" exit /b 0
>>"%STATUS_FILE%" echo computer=%COMPUTERNAME%
>>"%STATUS_FILE%" echo last_run=%DATE% %TIME%
>>"%STATUS_FILE%" echo result=%~1
>>"%STATUS_FILE%" echo robocopy_rc=%~2
>>"%STATUS_FILE%" echo source=%SOURCE_DIR%
>>"%STATUS_FILE%" echo run_as=%USERNAME%
exit /b 0
