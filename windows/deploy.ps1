# Развёртывание сайта писателя Василия Попкова на Cloudflare
# Запускается из «Развернуть сайт.bat». Секреты вводятся здесь и никуда не записываются.
$ErrorActionPreference = "Continue"   # ошибки внешних команд проверяем по $LASTEXITCODE
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }
function RandomSecret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ }) }

Step "Проверяю Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js не установлен. Скачайте LTS-версию с https://nodejs.org, установите и запустите этот файл снова." -ForegroundColor Yellow
  exit 1
}
node --version

Step "Устанавливаю инструменты Cloudflare (wrangler)"
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install не выполнен" }

Step "Вход в Cloudflare"
# Вход по API-токену: вход через браузер не работает, если трафик идёт через VPN/прокси
if (-not $env:CLOUDFLARE_API_TOKEN) {
  Write-Host "Нужен API-токен Cloudflare (инструкция — в сообщении Claude). Токен не сохраняется." -ForegroundColor Yellow
  $env:CLOUDFLARE_API_TOKEN = (Plain (Read-Host "Вставьте API-токен Cloudflare (символы не видны)" -AsSecureString)).Trim()
}
$who = (npx wrangler whoami 2>&1 | Out-String)
if ($who -notmatch "(?i)account id|associated with") { Write-Host $who; throw "Токен не подошёл — проверьте права и попробуйте снова" }
Write-Host "Вход выполнен" -ForegroundColor Green

Step "Хранилище для книг (R2)"
$t0 = Get-Content wrangler.toml -Raw -Encoding UTF8
if ($t0 -notmatch "r2_buckets") {
  $t0 = $t0.TrimEnd() + "`r`n`r`n[[r2_buckets]]`r`nbinding = `"BOOKS`"`r`nbucket_name = `"popkov-books`"`r`n"
  [IO.File]::WriteAllText((Resolve-Path wrangler.toml), $t0, (New-Object System.Text.UTF8Encoding $false))
}
$r2 = (npx wrangler r2 bucket create popkov-books 2>&1 | Out-String)
Write-Host $r2
$r2ok = ($LASTEXITCODE -eq 0) -or ($r2 -match "already exists|10004")
if (-not $r2ok) {
  Write-Host "Хранилище R2 не включено — сайт, CRM и бот заработают, а скачивание книг включится после R2." -ForegroundColor Yellow
  Write-Host "Включите R2: dash.cloudflare.com → R2 → подключить бесплатный тариф, затем запустите этот файл снова." -ForegroundColor Yellow
  $t = Get-Content wrangler.toml -Raw -Encoding UTF8
  $t = $t -replace '(?s)\[\[r2_buckets\]\].*?bucket_name = "popkov-books"\s*', ''
  [IO.File]::WriteAllText((Resolve-Path wrangler.toml), $t, (New-Object System.Text.UTF8Encoding $false))
}
$root = "C:\Users\ADMIN PC\Desktop\Документы ИТ\Личное"
$files = [ordered]@{
  "epub/zoloto-imperii.epub"           = "$root\Золото Империи\Электронная книга — Золото Империи\Редакция 5\Золото Империи — электронная книга.epub"
  "epub/libereya-pechat-molchaniya.epub" = "$root\Тайна Либереи\Электронная книга — Тайна Либереи\Авторская редакция — 23 октября 2026\Либерея. Печать молчания — электронная книга.epub"
  "epub/morskaya-zvezda.epub"          = "$root\Морская звезда 2\Электронная книга с иллюстрациями\Морская звезда — иллюстрированная книга.epub"
  "epub/inkognito.epub"                = "$root\Инкогнито\Электронная книга — Инкогнито\Инкогнито — электронная книга.epub"
  "epub/kristall-schastya.epub"        = "$root\Кристалл счастья\Электронная книга — Кристал счастья\Кристал счастья — электронная книга.epub"
  "epub/sertifikat-genialnosti.epub"   = "$root\Сертификат гениальности\Электронная книга — Сертификат гениальности\Сертификат гениальности — электронная книга.epub"
  "epub/ispoved.epub"                  = "$root\Исповедь. Рассказы ни о чём\Василий Попков. Исповедь. Рассказы ни о чём.epub"
}
if ($r2ok) {
Step "Загружаю электронные книги (7 файлов, до 75 МБ каждый)"
foreach ($k in $files.Keys) {
  $f = $files[$k]
  if (-not (Test-Path -LiteralPath $f)) { Write-Host "Нет файла: $f" -ForegroundColor Yellow; continue }
  Write-Host "  $k"
  npx wrangler r2 object put "popkov-books/$k" --file "$f" --content-type "application/epub+zip" --remote
  if ($LASTEXITCODE -ne 0) { throw "Не удалось загрузить $k" }
}
}

Step "Telegram-бот"
$bot = (Read-Host "Имя бота без @ (например popkov_books_bot)").Trim().TrimStart("@")
$toml = (Get-Content wrangler.toml -Raw -Encoding UTF8) -replace 'BOT_USERNAME = "[^"]*"', "BOT_USERNAME = `"$bot`""
[IO.File]::WriteAllText((Resolve-Path wrangler.toml), $toml, (New-Object System.Text.UTF8Encoding $false))

Step "Публикую сайт"
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Публикация не удалась" }

Step "Секреты"
$crm = Plain (Read-Host "Пароль для CRM (символы не видны)" -AsSecureString)
$tok = Plain (Read-Host "Токен бота от @BotFather (символы не видны)" -AsSecureString)
$hook = RandomSecret
$crm  | npx wrangler secret put CRM_PASSWORD
$tok  | npx wrangler secret put TG_TOKEN
RandomSecret | npx wrangler secret put SESSION_SECRET
$hook | npx wrangler secret put TG_WEBHOOK_SECRET

$site = ((Get-Content wrangler.toml -Raw -Encoding UTF8) | Select-String 'SITE_URL = "([^"]+)"').Matches[0].Groups[1].Value
Step "Подключаю бота к сайту"
$u = "https://api.telegram.org/bot$tok"
Invoke-RestMethod "$u/setWebhook" -Method Post -ContentType "application/json; charset=utf-8" -Body (@{
  url = "$site/tg/$hook"; secret_token = $hook; allowed_updates = @("message", "callback_query"); drop_pending_updates = $true
} | ConvertTo-Json) | Out-Host
Invoke-RestMethod "$u/setMyCommands" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes((@{
  commands = @(@{ command = "start"; description = "Меню" })
} | ConvertTo-Json -Depth 4))) | Out-Null

Write-Host ""
Write-Host "Готово!" -ForegroundColor Green
Write-Host "Сайт:  $site"
Write-Host "CRM:   $site/crm/"
Write-Host "Бот:   https://t.me/$bot"
Write-Host "Чтобы получать уведомления, напишите боту: /admin <пароль от CRM>"
