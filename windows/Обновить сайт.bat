@echo off
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Read-Host 'API-токен Cloudflare (символы не видны)' -AsSecureString; $env:CLOUDFLARE_API_TOKEN = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))).Trim(); if ($env:CLOUDFLARE_API_TOKEN -notmatch '^[A-Za-z0-9_\-]{30,}$') { Write-Host 'Это не похоже на API-токен: вставилось что-то лишнее. Скопируйте в Cloudflare только сам токен и запустите снова.' -ForegroundColor Yellow; exit 1 }; npx wrangler deploy"
echo.
pause
