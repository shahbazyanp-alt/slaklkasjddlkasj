# Runbook: Deploy (Render)

## Цель
Безопасно выкатывать изменения в `tracker-web` / `tracker-worker`.

## Перед деплоем
- Изменения в `main`
- Обновлена документация в `prod1/`
- Проверен `npm`/миграции локально (по возможности)

## Шаги
1. Push в `main`.
2. Render auto-deploy или Manual Deploy latest commit.
3. Проверить события деплоя: статус `live`.
4. Проверить `GET /health`.
5. Smoke:
   - логин
   - `/api/wallets`
   - `/api/summary`
   - вкладка `Кошельки`/`Сводка`

## Откат
- Render → service → deploys → Rollback на предыдущий `live`.

## Частые проблемы
- Старая UI-версия: hard refresh.
- Расхождение цифр: проверить, что смотришь правильный домен (`tracker-web-9d6e.onrender.com`).
