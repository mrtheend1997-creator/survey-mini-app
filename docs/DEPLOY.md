# Установка FTI Survey на сервер

Инструкция для IT-специалиста. Итог: приложение работает по адресу `https://ваш-домен`, открывается из Telegram-бота, данные хранятся в PostgreSQL, каждый день делается резервная копия.

## Что понадобится

- Сервер Linux (Ubuntu 22.04/24.04), от 1 vCPU / 2 ГБ RAM / 20 ГБ диска.
- Домен (или поддомен), например `survey.example.uz`, с A-записью на IP сервера.
- Открытые порты **80** и **443**.
- Аккаунт Telegram для создания бота.

## Шаг 1. Создать бота в Telegram

1. Откройте [@BotFather](https://t.me/BotFather), отправьте `/newbot`, задайте имя и username.
2. Сохраните **токен** (вида `1234567890:AA...`). Это секрет: никому не пересылайте.
3. (Необязательно) `/setdescription`, `/setuserpic` для оформления.
4. (Необязательно, для ссылки вида `t.me/bot/app`) `/newapp` → выберите бота → укажите URL `https://ваш-домен`.

Кнопку меню «📋 FTI Survey» бот настроит сам при запуске.

## Шаг 2. Узнать Telegram ID первого администратора

Напишите боту [@userinfobot](https://t.me/userinfobot); он ответит числом `Id`. Это ID будущего Super Admin.

## Шаг 3. Установить Docker на сервер

```bash
curl -fsSL https://get.docker.com | sh
```

## Шаг 4. Получить исходный код

```bash
git clone https://github.com/mrtheend1997-creator/survey-mini-app.git
cd survey-mini-app
```

## Шаг 5. Заполнить настройки

```bash
cp .env.example .env
nano .env
```

| Переменная | Что указать |
|---|---|
| `BOT_TOKEN` | токен из шага 1 |
| `WEBAPP_URL` | `https://ваш-домен` |
| `SITE_ADDRESS` | `ваш-домен` (без `https://`), для него автоматически выпускается HTTPS-сертификат |
| `SUPER_ADMIN_TELEGRAM_IDS` | ID из шага 2 (несколько через запятую) |
| `POSTGRES_PASSWORD` | длинный случайный пароль (`openssl rand -hex 24`) |
| `APP_TIMEZONE` | часовой пояс для статистики, по умолчанию `Asia/Tashkent` |
| `BACKUP_KEEP_DAYS` | сколько дней хранить резервные копии (по умолчанию 14) |

Файл `.env` содержит секреты: не добавляйте его в git (он уже в `.gitignore`).

## Шаг 6. Запустить

```bash
docker compose up -d --build
docker compose ps        # все сервисы должны быть в состоянии running
```

Что запускается:

| Сервис | Назначение |
|---|---|
| `db` | PostgreSQL 16, данные в томе `pgdata` |
| `api` | FastAPI; при старте сам применяет миграции БД (`alembic upgrade head`) |
| `web` | Caddy: отдаёт приложение, проксирует `/api`, **сам получает и продлевает HTTPS-сертификат** Let's Encrypt |
| `bot` | Telegram-бот: отвечает на `/start` кнопкой открытия приложения |
| `backup` | раз в сутки делает `pg_dump` в папку `./backups` |

Проверка: откройте `https://ваш-домен/api/health` — должно быть `{"ok":true}`.

## Шаг 7. Подключить Mini App к Telegram

Ничего дополнительно делать не нужно: бот при запуске устанавливает кнопку меню с вашим `WEBAPP_URL`. Откройте бота, нажмите `/start` → «📋 So‘rovnomalar / Опросы».

Если меняли домен: исправьте `WEBAPP_URL` и `SITE_ADDRESS` в `.env` и выполните `docker compose up -d`.

## Шаг 8. Первый администратор

Пользователь с ID из `SUPER_ADMIN_TELEGRAM_IDS` при первом входе автоматически получает роль Super Admin и видит кнопку «⚙️ Boshqaruv paneli». Остальным ролям назначают через раздел «Пользователи» (пользователь должен хотя бы раз открыть приложение).

Альтернатива через командную строку:

```bash
docker compose exec api python -m app.cli make-admin 123456789
```

## Шаг 9. Запуск для пользователей

Отправьте пользователям ссылку на бота (`https://t.me/ваш_бот`). Администратор создаёт и публикует опрос по [руководству администратора](ADMIN_GUIDE.md).

---

## Резервные копии

- Создаются автоматически раз в сутки: `./backups/fti_survey_ГГГГММДД_ЧЧММ.sql.gz`.
- Рекомендуется дополнительно копировать папку `backups` на другой сервер/хранилище.
- Загруженные изображения хранятся в томе `uploads`.

Ручная копия:

```bash
docker compose exec -T db pg_dump -U fti --no-owner fti_survey | gzip > manual_$(date +%F).sql.gz
```

Восстановление (полностью заменяет текущие данные):

```bash
docker compose stop api bot
docker compose exec -T db psql -U fti -d postgres -c "DROP DATABASE fti_survey;" -c "CREATE DATABASE fti_survey OWNER fti;"
gunzip -c backups/fti_survey_XXXXXXXX_XXXX.sql.gz | docker compose exec -T db psql -U fti -d fti_survey
docker compose start api bot
```

## Обновление версии

```bash
git pull
docker compose up -d --build     # миграции БД применяются автоматически
```

## Журналы и диагностика

```bash
docker compose logs -f api       # ошибки API
docker compose logs -f web       # HTTPS / сертификаты
docker compose logs -f bot
```

| Проблема | Решение |
|---|---|
| Сертификат не выпускается | Проверьте A-запись домена и что порты 80/443 открыты |
| «Telegram ma'lumotlari tasdiqlanmadi / Не удалось проверить данные Telegram» | `BOT_TOKEN` в `.env` не от того бота, через которого открыто приложение |
| «Сессия истекла» | Приложение было открыто дольше `INIT_DATA_MAX_AGE` секунд; закройте и откройте заново |
| Нет кнопки панели управления | Проверьте `SUPER_ADMIN_TELEGRAM_IDS` и перезапустите: `docker compose up -d api` |

## Безопасность (чек-лист)

- `DEV_MODE` на сервере всегда `false` (так задано в `docker-compose.yml`).
- `.env` доступен только администратору сервера (`chmod 600 .env`).
- Порт PostgreSQL наружу не открыт (в compose он не публикуется).
- Регулярно обновляйте сервер и выполняйте `docker compose pull && docker compose up -d --build`.
