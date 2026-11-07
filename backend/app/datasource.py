"""Load dialogs from the organizers' API or from uploaded JSON.

Accepted shapes (all from the organizers' format):
  * full response: {"isSuccess": true, "data": {"dataset_group_id": ..., "records": [...]}}
  * {"dataset_group_id": ..., "records": [...]}
  * a list of records
  * a single record
The CORS problem from the FAQ is avoided because the backend does the GET.
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from . import config
from .schemas import Dialog


class DataSourceError(RuntimeError):
    pass


def parse_payload(payload, default_dataset: str = "UPLOAD") -> tuple[str, list[Dialog]]:  # noqa: ANN001
    dataset = default_dataset
    # Check isSuccess before the shape of `data`: on an unknown group_id the API answers
    # {"isSuccess": false, "error": "...", "data": null} — show its error, not «Неизвестный формат».
    if isinstance(payload, dict) and payload.get("isSuccess") is False:
        raise DataSourceError(f"API организаторов вернул ошибку: {payload.get('error') or 'isSuccess=false'} — проверьте group_id")
    if isinstance(payload, dict) and "data" in payload and isinstance(payload["data"], dict):
        payload = payload["data"]
    if isinstance(payload, dict) and "records" in payload:
        dataset = payload.get("dataset_group_id") or dataset
        records = payload["records"]
    elif isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict) and "transcript" in payload:
        records = [payload]
    else:
        raise DataSourceError("Неизвестный формат: ожидается ответ API, массив records или одна запись")
    try:
        return dataset, [Dialog.model_validate(r) for r in records]
    except Exception as exc:  # pydantic ValidationError
        raise DataSourceError(f"Ошибка формата записи: {exc}") from exc


def _url_for_group(group_id: str) -> str:
    if not config.API_URL:
        raise DataSourceError("CQA_API_URL не задан в backend/.env")
    parts = urlsplit(config.API_URL)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "group_id"]
    query.append(("group_id", group_id))
    return urlunsplit(parts._replace(query=urlencode(query)))


async def fetch_group(group_id: str) -> tuple[str, list[Dialog]]:
    url = _url_for_group(group_id)
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise DataSourceError(f"API ответил {resp.status_code}")
    try:
        payload = resp.json()
    except ValueError as exc:
        raise DataSourceError("API вернул не JSON") from exc
    return parse_payload(payload, default_dataset=group_id)
