# Деплой CQA

**Живой URL: <https://cqa-web-production.up.railway.app>**
Railway · проект `cqa-hackathon` · сервис `cqa-web` · провайдер оценки `mock`.
Проверка здоровья: <https://cqa-web-production.up.railway.app/api/health> → `{"ok":true,"dialogs":65,...}`.

Один Docker-контейнер = API (FastAPI) + собранный фронт (`frontend/dist`), бэкенд сам отдаёт фронт.
Код оценки (`backend/app/scorers/*`, `service.py`, `scoring.py`) деплоем не затронут — добавлены только файлы ниже.

| Файл | Зачем |
|---|---|
| `Dockerfile` | `python:3.12-slim`, ставит зависимости, копирует `backend/`, `frontend/dist`, `branding/`, `deploy/`; запускает uvicorn из `backend/` на `$PORT` (по умолчанию 8000) от не-root пользователя |
| `.dockerignore` | не пускает в образ `.env`, `.venv`, `node_modules`, базу и кэш записей |
| `deploy/fetch_seed.py` | при старте: если нет `backend/data/dev.json` (он в `.gitignore`), скачивает датасет из `CQA_API_URL` — свежий деплой сразу с диалогами |
| `deploy/smoke_test.py` | сквозная проверка любого адреса: список → «Оценить» → апелляция → пересмотр → правка чек-листа → запись звонка → экспорт |
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
