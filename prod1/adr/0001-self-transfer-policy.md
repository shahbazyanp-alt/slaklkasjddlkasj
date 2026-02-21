# ADR 0001: Политика обработки self-transfer

- Status: Accepted
- Date: 2026-02-21

## Context
Исторические self-transfer записи искажали сводку (пример: +36,827.22 USDT).

## Decision
1. Self-transfer не участвует в отчётах.
2. API слои `transfers`, `summary`, `balances` фильтруют такие записи.
3. Исторические проблемные строки подлежат одноразовой очистке.

## Consequences
### Positive
- Корректные итоговые суммы
- Предсказуемость отчётов

### Negative
- Нужно следить за консистентностью фильтра в новых endpoint'ах

## Alternatives considered
- Оставить как есть и объяснять в UI — отклонено.
