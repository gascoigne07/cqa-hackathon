# API-контракт CQA

Фронтенд работает только через эти эндпоинты. Базовый контракт — из ТЗ команды
(без изменений). Пометка **⊕** — расширение: закрывает дыру в контракте, без
него не работает конкретная функция из ТЗ (указано, какая). Бэкенд в этом
репозитории реализует всё ниже, интерактивная документация — `/docs`.

Общее: JSON, UTF-8. Ошибка — HTTP-код и `{"detail": "текст для пользователя"}`
(фронт показывает `detail` как есть). Коды: `400` неверный запрос, `404` не найдено,
`422` не прошла валидация, `502` ошибка источника данных/записи, `503` провайдер
недоступен.

---

## Диалоги

### `GET /api/dialogs`
```json
[{
  "conversation_id": "p1-ru-001", "channel": "agent chat", "language": "RU",
  "turns": 12, "preview": "Где посмотреть мой тариф? В приложении не нахожу.",
  "dataset": "DEV", "has_audio": false,
  "last_score": { "score_id": 7, "total": 84, "original_total": 84, "gross_error": false,
                  "needs_review": false, "open_appeals": 0, "checklist_id": 1,
                  "provider": "gemini", "created_at": "2026-11-07T08:24:00Z" }
}]
```
`preview` — первая реплика клиента, до 140 символов.
⊕ `dataset`, `has_audio`, `last_score` (null, если не оценён) — колонки «Итог/Статус» в списке.

### `GET /api/dialogs/{id}`
```json
{
  "conversation_id": "p4-ru-001", "channel": "voice call", "language": "RU",
  "audio_url": "/api/dialogs/p4-ru-001/audio",
  "audio_source_url": "https://…/invoke/Conversation/…",
  "transcript": [{ "idx": 0, "timestamp": "2026-11-03T13:10:00.6388245+00:00", "speaker": "system", "text": "…" }]
}
```
`idx` — позиция реплики с 0. `timestamp` — исходный (чаты `MM:SS`, звонки ISO 8601).
**Важно:** `audio_url` организаторов — это **HTML-страница плеера**, внутри неё
подписанная ссылка на MP3, которая живёт ~1 час. Поэтому `audio_url` в нашем ответе
указывает на MP3, который отдаёт наш бэк (⊕ `GET /api/dialogs/{id}/audio`), а
оригинал лежит в ⊕ `audio_source_url` (ссылка «плеер организаторов» в UI).

---

## Чек-лист

### `GET /api/checklists` — список (новые первыми)
```json
[{ "id": 3, "name": "Чек-лист качества звонков", "criteria_count": 8, "created_at": "…", "channel": "call" },
 { "id": 2, "name": "Чек-лист качества чатов", "criteria_count": 8, "created_at": "…", "channel": "chat" }]
```
⊕ `channel` — к каким диалогам применяется: `"chat"` | `"call"` | `"all"`. Для каждого канала
используется **самый новый** чек-лист этого канала (если такого нет — самый новый `"all"`).
Встроены два чек-листа: официальный для чатов (из PDF организаторов) и адаптация для звонков
(по разъяснению организаторов: те же 8 критериев и веса; №4 и №6 под устную речь).

### `GET /api/checklists/{id}`
```json
{
  "id": 2, "name": "Чек-лист качества чатов", "rounding": 2, "channel": "chat",
  "instructions": "«Нет» — действие было нужно, но оператор его пропустил… N/A — критерий неприменим по условию…",
  "criteria": [{
    "id": "consultation", "order": 4, "section": "Безопасность и решение",
    "name": "Корректная и полная консультация",
    "type": "scale", "weight": 20, "na_allowed": true,
    "scale_max": 20,
    "scale": [{ "value": 0, "label": "Ответа по существу нет…" }, { "value": 5, "label": "…" }, { "value": 10, "label": "…" },
              { "value": 15, "label": "…" }, { "value": 20, "label": "Все существенные вопросы закрыты…" }],
    "guidance": "Оцените ответ или следующий шаг… N/A — чат закончился до того, как клиент сформулировал запрос.",
    "gross_error_if": null
  }, {
    "id": "gross_errors", "order": 8, "section": "Грубые нарушения", "name": "Грубые ошибки",
    "type": "yes_no", "weight": 0, "na_allowed": false, "scale_max": null, "scale": [],
    "guidance": "Да — выявлено оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации…",
    "gross_error_if": "yes"
  }],
  "gross_error_policy": "flag", "note": "", "created_at": "…"
}
```
- `type`: `"yes_no"` | `"yes_no_na"` | `"scale"`. Для `yes_no_na` `na_allowed` всегда `true`;
  для `scale` N/A включается флагом `na_allowed`.
- `scale_max` — максимум шкалы; минимум = наименьшее `value` в `scale` (0, если ступеней нет).
- `rounding` — знаков после запятой у итога (ROUND_HALF_UP; по чек-листу организаторов — 2).
- `weight` ≥ 0. **Вес 0 — критерий без баллов** (в официальном чек-листе «Грубые ошибки — без баллов»):
  оценивается и показывается, но в итог не входит.
- ⊕ `gross_error_if` — какой ответ означает **грубую ошибку**: `"yes"` (у «Грубых ошибок» «Да» = нарушение
  выявлено), `"no"` (провал критичного критерия) или `null`. В исходном контракте не было способа понять,
  какой критерий даёт грубую ошибку. (Старое поле `critical: true` принимается как `"no"`.)
- ⊕ `instructions` — общие правила чек-листа (как отличать «Нет» от N/A, что считать доказательством);
  отправляются модели вместе с критериями.
- ⊕ `gross_error_policy`: `"flag"` (только отметить, по ТЗ) | `"zero_total"`. ⊕ `note`, `created_at`.

### `POST /api/checklists`
Тело — как ответ выше, без `id`/`created_at`. Создаёт **новый** чек-лист с новым `id`
(старые оценки остаются со своим чек-листом). `order` нормализуется в 1..N.
Ответ — сохранённый чек-лист.

---

## Оценка

### `POST /api/score` — живой разбор
```json
{ "dialog_id": "p1-ru-001", "checklist_id": 2, "provider": "gemini" }
```
Каждый вызов **заново** вызывает модель (без кэша) и сохраняет результат.
`checklist_id`/`provider` можно не передавать — тогда **чек-лист по каналу диалога** (чат / звонок)
и провайдер по умолчанию.
```json
{
  "dialog_id": "p1-ru-001", "provider": "gemini", "total": 84, "gross_error": false,
  "sections": [{ "name": "Открытие", "points": 11.76, "max": 23.53 }],
  "results": [{
    "criterion_id": "greeting", "applicable": true, "na_reason": null,
    "verdict": "yes", "raw_score": 1, "scale_max": null,
    "points": 11.76, "effective_weight": 11.76,
    "explanation": "В первой реплике есть приветствие и имя оператора.",
    "evidence": { "turn_idx": 9, "timestamp": "01:15", "quote": "Здравствуйте! Меня зовут Алина." },

    "name": "Приветствие и представление", "section": "Открытие", "type": "yes_no",
    "weight": 10, "critical": false, "gross_error": false, "needs_review": false,
    "checked_range": null, "evidence_all": [ … ], "issues": [], "confidence": 0.9,
    "overridden": false, "original": null, "appeal": null
  }],
  "score_id": 31, "checklist_id": 2, "created_at": "…", "original_total": 84, "needs_review": false
}
```
Поля результата:
- `verdict`: `"yes"` | `"no"` | `"na"` | `"uncertain"`; для шкалы — подпись ступени (или число).
- `raw_score`: 1/0 для да/нет, значение шкалы, `null` для N/A.
- `applicable: false` ⇔ N/A, причина в `na_reason`.
- `evidence` — главная цитата или `null` (N/A, действие не найдено).

⊕ в результате: `name`/`section`/`type`/`weight`/`gross_error_if`/`na_allowed`/`scale`
(карточка и форма проверяющего без отдельного запроса чек-листа); `gross_error` (красный бейдж у критерия); `needs_review` и
`issues` (цитата не прошла проверку, N/A там, где запрещён); **`checked_range` —
`[от, до]` по `idx`: «если действие пропущено, укажите проверенный участок» из ТЗ**;
`evidence_all` (все цитаты); `overridden` + `original` + `appeal` (показать
«исходная → решение → финал»).

⊕ в ответе: **`score_id`** (к чему привязывать апелляцию), `checklist_id`,
`created_at`, **`original_total`** (итог до апелляций), `needs_review`, **`run`** —
доказательство живого анализа: `{ "model", "started_at", "duration_ms", "calls", "reused",
"judged", "prompt_tokens", "completion_tokens" }`.

### ⊕ `GET /api/scores/{score_id}/trace`
Каждый вызов модели за этой оценкой — что именно отправлено и что модель ответила:
```json
[{ "provider": "openai", "model": "gpt-4.1-mini", "criteria": ["contact", "needs", "…"],
   "system": "…системный промпт…", "user": "…правила, критерии, транскрипт…", "raw": "{\"judgments\": […]}",
   "duration_ms": 6400, "usage": { "prompt_tokens": 3100, "completion_tokens": 420 }, "note": "" }]
```
Пустой список — модель не вызывалась (все суждения переиспользованы).

### ⊕ `GET /api/export?format=csv|json&ids=a,b`
Последняя оценка каждого диалога (или только `ids`). CSV: строка на диалог — метаданные,
`total`, `gross_error`, и по каждому критерию `<id>.verdict` (для шкалы — балл ступени) и
`<id>.points`; UTF-8 с BOM. JSON: полный ответ оценки по каждому диалогу.

### Правила расчёта (одинаково на любом бэке)
- Нормализация s ∈ [0,1]: да = 1, нет = 0; шкала → `(raw − min) / (scale_max − min)`, верхняя ступень даёт полный вес.
  Шкальный ответ должен быть одной из ступеней; иное значение приводится к ближайшей ступени (и помечается).
- Критерии с весом 0 в расчёт не входят.
- N/A и `uncertain` исключаются; вес перераспределяется:
  `effective_weight = 100 × w / Σw_применимых` (в процентах), `points = effective_weight × s`,
  `total = Σ points` (0..100).
- Секция: `points = Σ points`, `max = Σ effective_weight` внутри секции.
- Грубая ошибка: ответ критерия совпал с его `gross_error_if`. Отмечается отдельно.
- Если применимых критериев с весом нет, итог не рассчитывается (`total: null`).
- Округление: итог — до `rounding` знаков, баллы и веса — до 2, ROUND_HALF_UP.

### ⊕ `GET /api/dialogs/{id}/score`
Последняя сохранённая оценка диалога — тот же формат, что у `POST /api/score`.
**Зачем:** `/api/score` живой, а после перезагрузки или апелляции нужно показать
сохранённый результат без нового вызова модели. `404`, если диалог не оценён.

### ⊕ `GET /api/providers` — для тумблера провайдера
```json
[{ "id": "gemini", "name": "Облако · Gemini", "kind": "cloud", "available": true, "note": "", "optional": false, "model": "gemini-…" },
 { "id": "qwen", "name": "Локально · Qwen3", "kind": "local", "available": false, "note": "Не задан CQA_QWEN_BASE_URL", "optional": false, "model": "" },
 { "id": "openai", "name": "Облако · OpenAI", "kind": "cloud", "available": false, "note": "Не задан CQA_OPENAI_API_KEY", "optional": true, "model": "" },
 { "id": "mock", "name": "Демо · ключевые слова", "kind": "demo", "available": true, "note": "", "optional": false, "model": "keywords-v1" }]
```
Недоступный провайдер показывается в тумблере выключенным с подсказкой `note`; `optional`
провайдеры (OpenAI, Groq — для тестов) скрыты, пока не настроены. `POST /api/score` с
недоступным провайдером отвечает `503`, ошибка самого провайдера (HTTP-ошибка API) — `502`.

### ⊕ Пакетная оценка (контрольный набор на H23, применение нового чек-листа)
- `POST /api/score/batch` `{ "dialog_ids": null, "checklist_id": null, "provider": "gemini", "reuse_unchanged": false }`
  → `{ "job_id", "status", "total", "done", "reused", "judged", "errors", "checklist_id", "provider" }`.
  `dialog_ids: null` — все диалоги; `checklist_id: null` — каждому диалогу чек-лист по его каналу. `reuse_unchanged: true` — для критериев, формулировка
  которых не изменилась с прошлой оценки диалога, берётся прошлое суждение
  (переоцениваются только изменённые — быстрая замена критерия на H23).
- `GET /api/score/batch/{job_id}` — статус.
- `GET /api/score/batch/{job_id}/events` — Server-Sent Events: `event: progress` / `event: done`, `data` — объект задачи.

---

## Апелляции

### `POST /api/appeals`
```json
{ "dialog_id": "p1-ru-001", "criterion_id": "greeting", "comment": "Имя скрыто системой",
  "author": "Оператор", "score_id": 31 }
```
→ `{ "appeal_id": 5 }`. ⊕ `score_id` (по умолчанию — последняя оценка диалога), ⊕ `author`.
`400`, если по критерию уже есть открытая апелляция или диалог не оценён.

### ⊕ `GET /api/appeals?status=open|resolved`
**Зачем:** экрану проверяющего нужен список апелляций — в контракте его не было.
```json
[{ "appeal_id": 5, "score_id": 31, "dialog_id": "p1-ru-001", "criterion_id": "greeting",
   "criterion_name": "Приветствие и представление", "comment": "…", "author": "Оператор",
   "status": "open", "created_at": "…", "review": null }]
```

### ⊕ `GET /api/appeals/{id}`
**Зачем:** «проверяющий видит спорную оценку, комментарий и фрагмент диалога» (ТЗ).
```json
{ "appeal": { …как в списке… },
  "result": { …результат критерия на момент оценки (исходный)… },
  "fragment": [{ "idx": 7, "timestamp": "…", "speaker": "operator", "text": "…" }],
  "evidence_idx": [9], "total": 84, "original_total": 84 }
```
`fragment` — реплики вокруг доказательства (±2) или проверенный участок.

### `POST /api/reviews`
```json
{ "appeal_id": 5, "decision": "change", "new_verdict": "yes", "new_score": null,
  "reason": "Имя скрыто анонимизацией, приветствие есть", "reviewer": "Проверяющий" }
```
- `decision`: `"confirm"` | `"change"`.
- Для да/нет — `new_verdict`: `"yes"` | `"no"` (или `"na"`, если N/A разрешён).
- Для шкалы — `new_score` в пределах шкалы (или `new_verdict: "na"`).
- ⊕ `reviewer`.

→ `{ "result": { …полный ответ как у /api/score, уже с пересчитанным итогом… } }`.
У изменённого критерия `overridden: true`, в `original` — исходный вердикт/баллы,
в `appeal.review` — решение, причина, `total_before` → `total_after`.
Исходная оценка не затирается: `original_total` остаётся прежним.

---

## ⊕ Загрузка данных
- `POST /api/datasets/import` `{ "group_id": "DEV" }` — бэк сам делает GET к API организаторов
  (нет проблем с CORS) → `{ "dataset", "imported", "updated" }`. На H23 — тот же вызов с новым `group_id`.
- `POST /api/dialogs/upload` (multipart, поле `file`) — JSON в формате организаторов:
  ответ API целиком, массив `records` или одна запись.

## ⊕ Логотип в шапке
- `GET /api/branding` → `{ "logo_url": "/api/branding/logo?v=…" | null }` — файл `logo.svg|png|webp|jpg`
  из папки `branding/` (или `CQA_BRANDING_DIR`). Нет файла или эндпоинта — в шапке просто «CQA».
- `GET /api/branding/logo` — сам файл (404, если не задан).

## Если пишешь свой бэк
Минимум, без которого экраны не работают: базовые эндпоинты + `score_id`/`original_total`
в ответе оценки, `GET /api/dialogs/{id}/score`, `GET /api/appeals`, `GET /api/appeals/{id}`,
`gross_error_if` в критерии, вес 0 для критериев без баллов, `channel` у чек-листа и проигрываемый `audio_url`. Остальные ⊕ фронт переживёт:
нет `/api/providers` — тумблер покажет Gemini/Qwen без проверки доступности; нет
пакетной оценки — «Оценить все» покажет, что бэкенд её не поддерживает; нет `last_score` —
пустая колонка итога; нет `name` в результате — название берётся из чек-листа.
