# ЭкоВес

PWA для быстрого и прозрачного учёта школьной макулатуры. Проект запускается сразу в демо-режиме; для общего многопользовательского доступа подключается Supabase.

## Быстрый запуск

```bash
npm install
npm run dev
```

Откройте адрес из терминала. Демо-аккаунты:

- `student@demo.ru` — ученик;
- `admin@demo.ru` — администратор;
- пароль в демо-режиме может быть любым.

## Подключение Supabase

1. Создайте проект в Supabase.
2. Выполните `supabase/schema.sql` в SQL Editor.
3. Скопируйте `.env.example` в `.env` и вставьте Project URL и anon key.
4. В Authentication включите Email; при необходимости — Google.
5. Создайте классы и назначьте `class_id` ученикам через Table Editor.
6. Перезапустите `npm run dev`.

## Production

```bash
npm run build
npm run preview
```

Папку `dist` можно разместить на Vercel, Firebase Hosting или другом статическом хостинге. Для Vercel уже добавлен `vercel.json`.

Полная концепция, UX, роли, API, безопасность, геймификация, внедрение и монетизация находятся в [PROJECT_DOCUMENT.md](./PROJECT_DOCUMENT.md).
