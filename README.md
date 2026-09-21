# Skupki.net v3.2 — old UI + smart Skupi + wallet top-up

Версия возвращает UX старого Skupki.net по референсам: верхняя навигация, тёмная тема, большой синий баннер, две карточки сценария продажи, 6 карточек игр и двухколоночный экран чатов.

## Что добавлено

- Skupi mini-AI собирает: игру → публичный ID/UID аккаунта → данные для оценки → подтверждение владения → e-mail → OTP → реквизиты.
- Полный номер карты, CVV, PIN и банковские SMS-коды в чат не принимаются. Реквизиты идут через PaymentProvider.
- E-mail OTP через Resend. Без `RESEND_API_KEY` в локальном dev код возвращается как devCode; в production e-mail-провайдер обязателен.
- Mock PaymentProvider для безопасного теста.
- YooKassa payout widget adapter для токенизации реквизитов.
- Кошелёк с пополнением: mock-пополнение работает сразу; реальное включается только через официальный merchant-аккаунт и `ENABLE_REAL_TOPUPS=true`.

## Railway

Загрузи **все** файлы из этой папки в корень GitHub-репозитория, включая `src/` и `public/`.

Railway сам выполнит:

```bash
npm install
npm start
```

В Variables для первого запуска достаточно:

```env
NODE_ENV=production
PAYMENT_PROVIDER=mock
ENABLE_REAL_PAYOUTS=false
ENABLE_REAL_TOPUPS=false
```

Чтобы Skupi был именно AI, а не локальным fallback, добавь `OPENAI_API_KEY`.
Чтобы код реально приходил на почту, добавь `RESEND_API_KEY`, `EMAIL_FROM` и свой подтверждённый домен.

## Важно для реальных платежей

Не включай реальные пополнения/выплаты до официального merchant/KYC-подключения провайдера. Skupki не должен хранить полный номер карты. Текущий in-memory кошелёк — прототип: после перезапуска сервера баланс сбросится. Для релиза подключи постоянную БД (Postgres).
