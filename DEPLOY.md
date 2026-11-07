# Деплой CQA

**Живой URL: <https://cqa-web-production.up.railway.app>**
Railway · проект `cqa-hackathon` · сервис `cqa-web` · провайдер оценки `mock` (публичный `/api/score` на Claude тратит кредит —
Claude включаем только на окно демо, см. «Флип на Claude»).
Проверка здоровья: <https://cqa-web-production.up.railway.app/api/health> → `{"ok":true,"dialogs":65,...}`.

Один Docker-контейнер = API (FastAPI) + собранный фронт (`frontend/dist`), бэкенд сам отдаёт фронт.
Код оценки (`backend/app/scorers/*`, `service.py`, `scoring.py`) деплоем не затронут — добавлены только файлы ниже.

| Файл | Зачем |
|---|---|
| `Dockerfile` | `python:3.12-slim`, ставит зависимости, копирует `backend/`, `frontend/dist`, `branding/`, `deploy/`; запускает uvicorn из `backend/` на `$PORT` (по умолчанию 8000) от не-root пользователя |
| `.dockerignore` | не пускает в образ `.env`, `.venv`, `node_modules`, базу и кэш записей |
| `deploy/fetch_seed.py` | при старте: если нет `backend/data/dev.json` (он в `.gitignore`), скачивает датасет из `CQA_API_URL` — свежий деплой сразу с диалогами |
| `deploy/smoke_test.py` | сквозная проверка любого адреса: список → «Оценить» → апелляция → пересмотр → правка чек-листа → запись звонка → экспорт |
| `deploy/flip.sh` | переключение живого сервиса mock ⇄ Claude на окно демо (`claude` / `mock` / `status`, `DRY_RUN=1`) |
| `railway.json`, `.railwayignore` | сборка по Dockerfile, healthcheck `/api/health`; что не загружать через `railway up` |
| `render.yaml` | Blueprint для Render (запасной вариант) |

## Переменные окружения

Задаются в панели хостинга (Railway → сервис → Variables; Render → Environment). **В git не коммитить.**

| Переменная | Значение | Обязательна |
|---|---|---|
| `CQA_API_URL` | подписанная GET-ссылка организаторов (кнопка «Открыть GET для DEV»); `group_id` подставляется сам | да — для загрузки данных и «Импорт из API» |
| `CQA_DEFAULT_PROVIDER` | `mock` сейчас; после интеграции судьи — id провайдера ML-команды | да |
| `CQA_CORS_ORIGINS` | `*` | да |
| `CQA_SEED_GROUP` | `DEV` — какой набор скачать при старте, если нет `dev.json` | нет |
| `CQA_ANTHROPIC_API_KEY` | ключ Claude — **только на окно демо**, ставит `deploy/flip.sh claude` | на демо |
| `CQA_ANTHROPIC_MODEL` | модель Claude (по умолчанию `claude-sonnet-5`) | опц. |
| `CQA_CLAUDE_SAMPLES` | голосов self-consistency на критерий (по умолчанию 5) | опц. |
| `CQA_GEMINI_API_KEY`, `CQA_GEMINI_MODEL` | ключ/модель Gemini | когда подключат |
| `CQA_OPENAI_API_KEY`, `CQA_OPENAI_MODEL` | OpenAI | опц. |
| `CQA_GROQ_API_KEY`, `CQA_GROQ_MODEL` | Groq | опц. |
| `CQA_QWEN_BASE_URL`, `CQA_QWEN_MODEL`, `CQA_QWEN_API_KEY` | OpenAI-совместимый сервер с Qwen3 | опц. |
| `CQA_CONCURRENCY` | параллельных оценок в пакете (4) | опц. |
| `CQA_DB_URL` | внешняя БД вместо SQLite, напр. Postgres | опц. |
| `PORT` | ставит сама платформа — не задавать | — |

Смена переменной в Railway сама перезапускает сервис.

## Локальная проверка

```bash
docker build -t cqa .
docker run -p 8000:8000 cqa                          # с dev.json из папки — 65 диалогов DEV
docker run -p 8000:8000 --env-file backend/.env cqa  # как в проде: ключи и CQA_API_URL из .env
python3 deploy/smoke_test.py http://localhost:8000
```

Обновлено 7 ноября, 23:00: задеплоена текущая версия (v2 + Claude-провайдер + вкладка «Точность» + уверенность ИИ),
на живом URL проверены «Диалоги» (65), «Результат» («уверенность — демо» на mock), «Чек-лист», «Апелляции», «Точность».
Проверено 7 ноября: оба режима старта (с `dev.json` и со скачиванием из API), healthcheck `healthy`,
smoke-тест 10/10 локально и на живом URL; в браузере — список, «Оценить», апелляции, чек-лист.

## Деплой на Railway (как сделан текущий)

Нужен Railway CLI (`brew install railway`) и вход: `railway login`.

```bash
railway init --name cqa-hackathon                    # проект, привязка папки
railway add --service cqa-web \
  -v CQA_DEFAULT_PROVIDER=mock -v "CQA_CORS_ORIGINS=*" -v CQA_SEED_GROUP=DEV \
  -v "CQA_API_URL=<ссылка организаторов>"
railway up --service cqa-web --detach                # загрузка папки и сборка по Dockerfile
railway domain --service cqa-web                     # публичный *.up.railway.app
```

- **Обновить после правок кода:** `railway up --service cqa-web --detach` из корня проекта.
- **Сбросить данные демо** (оценки, апелляции, версии чек-листа): `railway redeploy --service cqa-web --yes`.
- **Логи:** `railway logs --service cqa-web` (сборка — `--build`).
- Вариант без CLI: Railway → New Project → Deploy from GitHub repo → `cqa-hackathon` → Variables (таблица выше) →
  Settings → Networking → Generate Domain. Сборка возьмёт `Dockerfile` и `railway.json`.

## Флип на Claude (окно демо)

Сайт всё время работает на `mock`; Claude включаем только на время показа и сразу выключаем — иначе любой с адресом
жжёт кредит (одно «Оценить» = 5 вызовов модели, «Применить ко всем диалогам» = 65 × 5 = 325 вызовов).

**Один раз заранее:** положить ключ в `backend/.env` (он в `.gitignore`, в git не попадает):
```
CQA_ANTHROPIC_API_KEY=sk-ant-...
# по желанию: CQA_ANTHROPIC_MODEL=claude-sonnet-5   CQA_CLAUDE_SAMPLES=5
```
Нужен Railway CLI с входом и привязкой к проекту: `railway login`, затем в корне проекта `railway link` (проект `cqa-hackathon`).

**Перед демо — одна команда** (из корня проекта):
```bash
deploy/flip.sh claude
```
Скрипт передаёт ключ в Railway через stdin (не светится ни в аргументах, ни в истории), ставит
`CQA_DEFAULT_PROVIDER=claude`, делает **один** редеплой, ждёт `SUCCESS` (~1–2 мин) и печатает статус:
`Claude: ВКЛЮЧЁН (claude-sonnet-5)`. Затем на демо-машине:
1. обновить страницу и выбрать **«Облако · Claude»** в переключателе модели — браузер помнит прошлый выбор (`Демо`);
2. редеплой стёр данные → **после** флипа оценить 3–4 диалога, завести апелляцию (подготовка демо);
3. «Применить ко всем диалогам» на Claude не нажимать без нужды (325 вызовов).

**Сразу после демо — вернуть mock:**
```bash
deploy/flip.sh mock
```
Удаляет `CQA_ANTHROPIC_API_KEY` из Railway (это само запускает редеплой) и ставит `CQA_DEFAULT_PROVIDER=mock`.
Статус в любой момент: `deploy/flip.sh status`. Репетиция без изменений: `DRY_RUN=1 deploy/flip.sh claude`.

**Без скрипта (панель Railway):** сервис `cqa-web` → Variables → добавить `CQA_ANTHROPIC_API_KEY`, поменять
`CQA_DEFAULT_PROVIDER` на `claude` → Deploy. Назад: удалить ключ, `CQA_DEFAULT_PROVIDER=mock` → Deploy.
Если после флипа статус всё ещё «Claude: выключен» — `railway up --service cqa-web --detach` (новый деплой с текущими переменными).

## Деплой на Render (запасной)

Dashboard → New → Blueprint → репозиторий → Render прочитает `render.yaml` и попросит значение `CQA_API_URL`.
Бесплатный сервис засыпает после 15 минут без запросов, первый запрос после сна ~1 минута,
750 часов в месяц на воркспейс — перед демо открыть URL заранее.

## Важно знать

- **Данные не сохраняются между деплоями.** SQLite лежит на диске контейнера: `railway up`, `redeploy`, перезапуск
  или сон (Render) стирают оценки и апелляции; при старте снова загружаются 65 диалогов и два встроенных чек-листа.
  Демо-машину готовить **после** последнего деплоя: оценить 3–4 диалога, завести апелляцию. Railway сервис не усыпляет.
- **Smoke-тест оставляет следы** (апелляцию и копию чек-листа «smoke test», которая открывается первой во вкладке
  «Чек-лист») — после проверки живого URL сделайте `railway redeploy`.
- **Входа нет** (по ТЗ): любой с адресом может оценивать, подавать апелляции и менять чек-лист.
- `CQA_API_URL` содержит подпись `sig=` — по сути пароль к данным организаторов. Только в переменных хостинга и `backend/.env`.
- Аккаунт Railway сейчас на **Limited Trial** («30 days or $5»); в панели есть «Unlock Full Trial» — лучше разблокировать
  до демо, чтобы сервис не остановили. Бесплатный план Railway: $1 кредитов в месяц, 0.5 GB RAM на сервис.
- Railway помечает `railway.json` как устаревший формат (работает до 01.12.2026); после хакатона — `railway config migrate`.
- Переключение на настоящую модель: задать ключ провайдера и `CQA_DEFAULT_PROVIDER` в Variables — код не трогаем.

## Контрольный этап H23
Пошаговый runbook (импорт нового group_id → замена критерия → переоценка → экспорт), реальные тайминги
и подводные камни — в **[deploy/CONTROL_RUNBOOK.md](deploy/CONTROL_RUNBOOK.md)**. Безопасная переоценка
только контрольных диалогов: `deploy/h23_control.sh`. Отчёт dry-run + баги — `deploy/DRYRUN_H23.md`.
