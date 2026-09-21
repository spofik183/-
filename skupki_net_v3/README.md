# Skupki.net v3 — Skupi mini‑AI + Email OTP + PaymentProvider

Готовый Node.js/Express прототип текущего Skupki.net с серверным Skupi.

## Что изменено

- **Skupi mini‑AI** использует OpenAI Responses API и function calling.
- Модель понимает свободные сообщения, сохраняет игру/платформу/ранг/инвентарь/прогресс и помнит контекст сделки.
- Готовность сделки к следующему шагу вычисляет **сервер**, а не ИИ.
- Если пользователь присылает e‑mail прямо в чат, Skupi может вызвать серверное действие отправки OTP.
- **E‑mail OTP** отправляется через Resend. В production без настроенного Resend код никогда не показывается в интерфейсе.
- OTP хранится как HMAC-хэш, действует 10 минут, имеет cooldown и лимит попыток.
- **PaymentProvider**: mock для разработки + YooKassa adapter для официально подключённого merchant-аккаунта.
- Номер карты не отправляется в чат и не хранится в Skupki: для YooKassa используется hosted payout widget, который возвращает `payout_token` и маску карты.
- ИИ технически не может одобрить сделку или выполнить выплату.

## Быстрый запуск

```bash
cp .env.example .env
npm install
npm run dev
```

Открыть: `http://localhost:3000/chat`

## Подключить Skupi AI

В `.env`:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna
```

Ключ хранится только на сервере.

## Подключить письма

Создай ключ Resend, подтверди домен и укажи:

```env
RESEND_API_KEY=...
EMAIL_FROM=Skupki <code@skupki.net>
OTP_PEPPER=длинная_случайная_строка
```

В development без ключа код выводится как DEV-подсказка. В `NODE_ENV=production` такого fallback нет.

## Платёжный провайдер

По умолчанию включён безопасный sandbox:

```env
PAYMENT_PROVIDER=mock
ENABLE_REAL_PAYOUTS=false
```

После официального подключения выплат у провайдера:

```env
PAYMENT_PROVIDER=yookassa
ENABLE_REAL_PAYOUTS=true
YOOKASSA_GATEWAY_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_AGENT_ID=...
```

В YooKassa реквизиты собирает их payout widget. Skupki получает только токен/маскированное представление карты.

**Важно:** реальные выплаты требуют официального merchant-подключения и выполнения требований провайдера. Этот проект не содержит и не должен содержать обходов KYC, возрастных ограничений или проверок личности.

## Перед настоящим релизом

Прототип хранит сделки в памяти процесса. Для production замени `Map()` на БД (Postgres/Supabase), добавь авторизацию администратора, webhook статусов выплат, журнал аудита, CSRF/anti-bot защиту и серверную модерацию передачи аккаунта. Также проверь правила конкретной игры: некоторые издатели запрещают передачу/продажу аккаунтов.
