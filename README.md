# CQA — Conversation Quality Analytics

Прототип для хакатона **Freedom Broker × Nazarbayev University**.
Оценивает работу оператора по диалогу (чат/звонок, RU/KZ/EN) по настраиваемому
чек-листу (LLM-as-judge), показывает обоснование с привязкой к репликам и даёт
процесс апелляции/пересмотра.

## Архитектура
- **Бэкенд:** Python + FastAPI, хранилище SQLite. Прокси к API организаторов (чинит CORS, прячет ключ, кеширует диалоги).
- **Движок оценки:** провайдер-агностик (OpenAI-совместимый). По умолчанию **Gemini** (free); локальная **Qwen3** — тумблер (диверсити). Промпт по критериям → строгий JSON → детерминированная математика.
- **Фронтенд:** статик HTML/CSS/JS, встраиваемо в Dynamics 365 (iframe / HTML Web Resource). Без логина.

## Математика оценки (правила чек-листа, стр. 2)
Применимость → вердикт (Да=полный вес / Нет=0 / шкала×вес) → исключить N/A и
пропорционально перераспределить веса до 100 → округлить до 2 знаков (half-up).
Грубые ошибки — отдельный флаг, из 100 не вычитаются.
Реализация: [`backend/scoring.py`](backend/scoring.py) · тесты: [`backend/test_scoring.py`](backend/test_scoring.py).

## Запуск
```bash
# тесты движка оценки (без зависимостей)
python3 backend/test_scoring.py

# бэкенд (TODO по мере сборки)
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
export GEMINI_API_KEY=...        # ключ: https://aistudio.google.com/app/apikey
uvicorn backend.app.main:app --reload

# фронтенд
open frontend/index.html
```

## Статус
- [x] Схема чек-листа (8 критериев) — `backend/checklists/default.json`
- [x] Движок математики + тесты (пример даёт 88.13)
- [ ] Провайдер Gemini + промпт-ядро
- [ ] REST-эндпоинты + прокси к API организаторов
- [ ] Фронтенд (4 экрана)
- [ ] Апелляция / пересмотр
- [ ] Калибровка на ручном Ground Truth
