@echo off
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Read-Host 'API-токен Cloudflare (символы не видны)' -AsSecureString; $env:CLOUDFLARE_API_TOKEN = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))).Trim(); npx wrangler deploy"
echo.
pause
