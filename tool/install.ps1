<#
  Cai dat tool copy report tren may san xuat. Goi qua 03-install-schedule.bat.

  2 che do, tu chon theo quyen luc chay:
  - "Run as administrator" -> che do SYSTEM
      Task chay ngam bang tai khoan SYSTEM, chay ca khi khong ai dang nhap / sau khi reboot.
      Tai khoan NAS luu trong Credential Manager cua SYSTEM (operator khong xem/xoa duoc).
  - Chay binh thuong       -> che do USER
      Task chay duoi user hien tai, chi chay khi user nay dang dang nhap.
      Tai khoan NAS luu trong Credential Manager cua user nay.

  Ca 2 che do: tai khoan luu bang cmdkey (Windows ma hoa bang DPAPI), ton tai vinh vien qua reboot,
  chi mat khi bi xoa (cmdkey /delete) hoac doi mat khau NAS -> chay lai file cai dat.
#>
$ErrorActionPreference = 'Stop'

$TaskName   = 'CopyMachineReport'
$InstallDir = 'C:\BatchReportTool'
$SrcDir     = $PSScriptRoot

# Ma ket qua dac biet cua Task Scheduler
$TASK_NOT_RUN_YET = 267011
$TASK_RUNNING     = 267009

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Stop-Install($msg) { Write-Host "`n[LOI] $msg" -ForegroundColor Red; exit 1 }

function Read-Default($prompt, $default) {
    $v = Read-Host "$prompt [$default]"
    if ([string]::IsNullOrWhiteSpace($v)) { return $default }
    return $v.Trim()
}

function Confirm-Yes($prompt) {
    $v = Read-Host "$prompt (Y/n)"
    return ([string]::IsNullOrWhiteSpace($v) -or $v.Trim().ToLower() -eq 'y')
}

# Doc gia tri mac dinh tu config.bat (dong dang: set "KEY=VALUE")
function Read-BatConfig($path) {
    $cfg = @{}
    if (Test-Path -LiteralPath $path) {
        foreach ($line in Get-Content -LiteralPath $path) {
            if ($line -match '^\s*set\s+"([A-Z_]+)=(.*)"\s*$') { $cfg[$Matches[1]] = $Matches[2] }
        }
    }
    return $cfg
}

# Doi task chay xong, tra ve LastTaskResult (hoac $null neu qua thoi gian)
function Wait-Task($name, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        $state = (Get-ScheduledTask -TaskName $name).State
        $res = (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult
        if ($state -ne 'Running' -and $res -ne $TASK_NOT_RUN_YET -and $res -ne $TASK_RUNNING) { return $res }
    }
    return $null
}

# Chay 1 lenh duoi quyen SYSTEM thong qua task tam, xoa task ngay sau khi chay
function Invoke-AsSystem($exe, $arguments) {
    $tmpName = 'BatchReportTool-Temp'
    $action = New-ScheduledTaskAction -Execute $exe -Argument $arguments
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    try {
        Register-ScheduledTask -TaskName $tmpName -Action $action -Principal $principal -Force | Out-Null
        Start-ScheduledTask -TaskName $tmpName
        return (Wait-Task $tmpName 30)
    } finally {
        Unregister-ScheduledTask -TaskName $tmpName -Confirm:$false -ErrorAction SilentlyContinue
    }
}

Write-Host '============================================================'
Write-Host ' Cai dat tool copy report len NAS'
Write-Host '============================================================'

# ------------------------------------------------------------
# 1. Xac dinh che do
# ------------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    $mode = 'SYSTEM'
    Write-Ok 'Dang chay voi quyen admin -> che do SYSTEM (chay ngam, khong can ai dang nhap)'
} else {
    $mode = 'USER'
    Write-Warn2 "Khong co quyen admin -> che do USER: task chi chay khi user [$($identity.Name)] dang dang nhap."
    Write-Warn2 'Neu may nay co tai khoan admin: dong cua so, chuot phai 03-install-schedule.bat -> Run as administrator.'
    if (-not (Confirm-Yes 'Tiep tuc cai o che do USER?')) { exit 0 }
}

# ------------------------------------------------------------
# 2. Cau hinh
# ------------------------------------------------------------
Write-Step 'Cau hinh (Enter = giu gia tri trong ngoac)'
$defaults = Read-BatConfig (Join-Path $SrcDir 'config.bat')

$sourceDir = (Read-Default 'Thu muc chua file PDF tren may nay' $defaults['SOURCE_DIR']).TrimEnd('\')
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
    Write-Warn2 "Thu muc $sourceDir chua ton tai."
    if (-not (Confirm-Yes 'Van tiep tuc?')) { exit 0 }
}

$nasRoot = (Read-Default 'Thu muc goc tren NAS' $defaults['NAS_ROOT']).TrimEnd('\')
if ($nasRoot -notmatch '^\\\\([^\\]+)\\[^\\]+') { Stop-Install 'Thu muc NAS phai co dang \\may-chu\share\...' }
$nasHost = $Matches[1]

$machineName = Read-Default 'Ten thu muc cua may nay tren NAS' $env:COMPUTERNAME
if ($machineName -notmatch '^[A-Za-z0-9._-]+$') { Stop-Install 'Ten may chi duoc dung chu, so, dau . _ -' }

# ------------------------------------------------------------
# 3. Luu tai khoan NAS
# ------------------------------------------------------------
Write-Step "Tai khoan truy cap NAS ($nasHost)"
$nasUser = Read-Host 'User NAS'
if ([string]::IsNullOrWhiteSpace($nasUser)) { Stop-Install 'Chua nhap user NAS' }
$nasUser = $nasUser.Trim()
$secure = Read-Host 'Mat khau NAS (khong hien khi go)' -AsSecureString

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ([string]::IsNullOrEmpty($plain)) { Stop-Install 'Chua nhap mat khau' }
if ($plain.Contains('"') -or $nasUser.Contains('"')) { Stop-Install 'User/mat khau khong duoc chua dau nhay kep (")' }

try {
    if ($mode -eq 'SYSTEM') {
        $rc = Invoke-AsSystem 'cmdkey.exe' "/add:$nasHost /user:`"$nasUser`" /pass:`"$plain`""
        if ($rc -ne 0) { Stop-Install "Khong luu duoc tai khoan cho SYSTEM (ma loi $rc)" }
        Write-Ok "Da luu tai khoan [$nasUser] cho SYSTEM"
    } else {
        & cmdkey.exe "/add:$nasHost" "/user:$nasUser" "/pass:$plain" | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-Install "Khong luu duoc tai khoan (cmdkey ma loi $LASTEXITCODE)" }
        Write-Ok "Da luu tai khoan [$nasUser] cho user [$($identity.Name)]"
    }
} finally {
    $plain = $null
}

# ------------------------------------------------------------
# 4. Copy file vao thu muc cai dat + phan quyen
# ------------------------------------------------------------
Write-Step "Cai file vao $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Chi SYSTEM + Administrators (+ user cai dat o che do USER) duoc sua file.
# Quan trong o che do SYSTEM: neu operator sua duoc file .bat thi se chay lenh bat ky voi quyen SYSTEM.
$grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX')
if ($mode -eq 'USER') { $grants += "*$($identity.User.Value):(OI)(CI)M" }
& icacls.exe $InstallDir /inheritance:r /grant:r @grants | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warn2 'Khong dat duoc phan quyen thu muc (icacls)' }
if (Get-ChildItem -LiteralPath $InstallDir) {
    # File cu tu lan cai truoc: bo quyen rieng, ke thua lai quyen cua thu muc
    & icacls.exe "$InstallDir\*" /reset /T /C /Q | Out-Null
}

# Neu nguoi dung chay ngay tu C:\BatchReportTool thi file da o dung cho, khong copy de len chinh no
$sameDir = ([IO.Path]::GetFullPath($SrcDir).TrimEnd('\') -ieq [IO.Path]::GetFullPath($InstallDir).TrimEnd('\'))
if (-not $sameDir) {
    Copy-Item -LiteralPath (Join-Path $SrcDir '02-copy-report.bat') -Destination $InstallDir -Force
    Copy-Item -LiteralPath (Join-Path $SrcDir 'run-hidden.vbs') -Destination $InstallDir -Force
}

$configLines = @(
    '@echo off',
    "REM Tao boi install.ps1 luc $(Get-Date -Format 'yyyy-MM-dd HH:mm') - che do $mode",
    "set `"SOURCE_DIR=$sourceDir`"",
    "set `"NAS_ROOT=$nasRoot`"",
    "set `"MACHINE_NAME=$machineName`""
)
[IO.File]::WriteAllText((Join-Path $InstallDir 'config.bat'), ($configLines -join "`r`n") + "`r`n", [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage))
Write-Ok 'Da copy 02-copy-report.bat, run-hidden.vbs, config.bat'

# ------------------------------------------------------------
# 5. Tao task chay moi 5 phut
# ------------------------------------------------------------
Write-Step "Tao task [$TaskName] chay moi 5 phut"
if ($mode -eq 'SYSTEM') {
    & schtasks.exe /create /tn $TaskName /tr "cmd.exe /c $InstallDir\02-copy-report.bat" /sc minute /mo 5 /ru SYSTEM /rl HIGHEST /f | Out-Null
} else {
    & schtasks.exe /create /tn $TaskName /tr "wscript.exe $InstallDir\run-hidden.vbs" /sc minute /mo 5 /f | Out-Null
}
if ($LASTEXITCODE -ne 0) { Stop-Install "Khong tao duoc task (schtasks ma loi $LASTEXITCODE). Task cu co the do user khac/admin tao - xoa task cu truoc." }

try {
    # - Chay ca khi may dung pin / UPS
    # - Lo lich (may tat, reboot) thi chay bu ngay khi co the
    # - Toi da 30 phut/lan: robocopy bi treo (mat mang) se bi dung, khong chan cac lan chay sau
    # - Lan truoc chua xong thi bo qua lan moi, khong chay chong
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
    Set-ScheduledTask -TaskName $TaskName -Settings $settings | Out-Null
    Write-Ok 'Da tao task va cau hinh (chay bu khi lo lich, gioi han 30 phut/lan, khong chay chong)'
} catch {
    Write-Warn2 "Task da tao nhung khong cap nhat duoc cau hinh nang cao: $($_.Exception.Message)"
}

# ------------------------------------------------------------
# 6. Chay thu
# ------------------------------------------------------------
Write-Step 'Chay thu 1 lan (lan dau co the lau neu nhieu file cu)...'
Start-ScheduledTask -TaskName $TaskName
$result = Wait-Task $TaskName 120

if ($null -eq $result) {
    Write-Warn2 'Task van dang chay (dang copy nhieu file). Xem log sau it phut.'
} elseif ($result -eq 0) {
    Write-Ok "Copy thanh cong -> $nasRoot\$machineName"
} elseif ($result -eq 2) {
    Write-Warn2 "Khong tim thay thu muc nguon $sourceDir"
} elseif ($result -eq 3) {
    Write-Warn2 'Khong vao duoc NAS: sai user/mat khau, hoac mat mang.'
    if ($mode -eq 'USER') {
        Write-Warn2 'Neu ban dang mo NAS bang tai khoan khac (Explorer, o mang da map), Windows khong cho dung 2 tai khoan'
        Write-Warn2 'cung luc -> dang xuat / khoi dong lai may roi kiem tra lai.'
    }
} else {
    Write-Warn2 "Ket qua: ma $result - xem log ben duoi"
}

$log = Join-Path $InstallDir 'logs\copy-report.log'
if (Test-Path -LiteralPath $log) {
    Write-Host "`n--- 5 dong cuoi cua $log ---"
    Get-Content -LiteralPath $log -Tail 5 | ForEach-Object { Write-Host "    $_" }
}

Write-Host ''
Write-Host '============================================================'
Write-Host " Che do      : $mode"
Write-Host " Task        : $TaskName (moi 5 phut)"
Write-Host " Thu muc tool: $InstallDir"
Write-Host " Copy tu     : $sourceDir"
Write-Host " Copy toi    : $nasRoot\$machineName"
Write-Host " Trang thai  : $nasRoot\_status\$machineName.txt"
Write-Host '============================================================'
if (Test-Path -LiteralPath 'C:\Scripts\02-copy-report.bat') {
    Write-Warn2 'Phat hien ban cu C:\Scripts\02-copy-report.bat - co the xoa (task cu da duoc thay the).'
}
