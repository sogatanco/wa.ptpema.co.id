@echo off
setlocal enabledelayedexpansion

REM Fungsi random string 8 karakter
:random_string
set "charset=abcdefghijklmnopqrstuvwxyz0123456789"
set "str="
for /l %%i in (1,1,8) do (
    set /a idx=!random! %% 36
    for /f "tokens=1" %%a in ("!charset:~!idx!,1!") do set "str=!str!%%a"
)
exit /b

set /a counter=0

:loop
set /a counter+=1
call :random_string
set "randstr=%str%"

REM Jalankan curl, simpan output ke file sementara
curl -s -L -w " HTTP_Status: %{http_code}\n" -H "Host: pge.id" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "http://103.229.73.15/?s=%randstr%" > tmpcurl.txt

REM Ambil dan echo status HTTP dari output
for /f "tokens=2" %%s in ('findstr /c:"HTTP_Status:" tmpcurl.txt') do (
    echo HTTP Status: %%s
)

REM Tampilkan seluruh output (opsional)
type tmpcurl.txt

REM Delay ~500ms (2 req/detik, lebih aman untuk testing)
ping -n 1 -w 500 127.0.0.1 >nul

goto loop
