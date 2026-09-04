# JIN — Telegram Mini App E-commerce

MVP Telegram Mini App для продажи премиальных физических товаров из Китая.

## Уже реализовано
- авторизация через Telegram Mini App `initData` с серверной проверкой подписи;
- каталог товаров без отдельной регистрации;
- поиск и категории;
- карточка товара;
- корзина и изменение количества;
- checkout;
- адрес доставки;
- Standard / Express доставка;
- создание Telegram invoice для физических товаров;
- открытие invoice через `Telegram.WebApp.openInvoice`;
- «Мои заказы»;
- статусы: awaiting payment / paid / processing / shipped / delivered / cancelled;
- tracking number;
- админ-статистика;
- список заказов и смена статуса;
- добавление товаров;
- учёт остатков после `successful_payment`;
- хранение данных в `db.json` для MVP.

## Важно
Этот шаблон рассчитан на легальные оригинальные товары/бренды. Не используйте его для контрафакта.

## Локальный запуск
```bash
npm install
npm start
```

По умолчанию `DEV_MODE=true`, поэтому приложение можно открыть обычным браузером.

## Telegram
1. Создайте бота в @BotFather.
2. Создайте Mini App / задайте Web App URL на ваш HTTPS-домен.
3. Добавьте `BOT_TOKEN`.
4. В BotFather: Bot Settings -> Payments подключите payment provider для физических товаров.
5. Добавьте `PAYMENT_PROVIDER_TOKEN`.
6. Укажите свой цифровой Telegram ID в `ADMIN_TELEGRAM_IDS`.
7. На production установите `DEV_MODE=false`.

## Webhook платежей
После деплоя установите webhook бота на:
`https://YOUR_DOMAIN/api/telegram/webhook`

Например Bot API методом `setWebhook`.

Без webhook приложение сможет создать invoice, но заказ не перейдёт автоматически в `paid` после SuccessfulPayment.

## Railway
Переменные:
- `BOT_TOKEN`
- `PAYMENT_PROVIDER_TOKEN`
- `ADMIN_TELEGRAM_IDS`
- `CURRENCY=EUR`
- `DEV_MODE=false`

Start Command:
`npm start`

После Deploy:
Settings -> Networking -> Generate Domain

## Для production
Для настоящего магазина стоит заменить `db.json` на PostgreSQL и добавить:
- S3/R2 для изображений;
- supplier/warehouse integration;
- реальный tracking API;
- возвраты/refunds;
- промокоды;
- CMS;
- журнал действий администраторов;
- tax/VAT calculation;
- privacy/terms/refund policies.
