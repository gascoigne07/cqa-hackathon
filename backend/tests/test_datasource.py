import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.datasource import DataSourceError, parse_payload
from app.main import app


def test_api_error_with_null_data_shows_api_message():
    # unknown group_id: the organizers' API answers isSuccess=false and data=null
    with pytest.raises(DataSourceError) as e:
        parse_payload({"isSuccess": False, "error": "Group not found", "data": None})
    assert "Group not found" in str(e.value)
    assert "Неизвестный формат" not in str(e.value)


def test_api_error_without_message():
    with pytest.raises(DataSourceError) as e:
        parse_payload({"isSuccess": False, "data": None})
    assert "isSuccess=false" in str(e.value)


def test_api_error_with_object_data_still_raises():
    with pytest.raises(DataSourceError) as e:
        parse_payload({"isSuccess": False, "error": "boom", "data": {"records": []}})
    assert "boom" in str(e.value)


def test_success_payload_still_parses():
    payload = json.loads((Path(__file__).parent / "fixtures" / "sample.json").read_text(encoding="utf-8"))
    dataset, dialogs = parse_payload(payload)
    assert dataset and dialogs


def test_upload_of_error_response_returns_api_message():
    with TestClient(app) as client:
        body = json.dumps({"isSuccess": False, "error": "Group not found", "data": None})
        r = client.post("/api/dialogs/upload", files={"file": ("d.json", body, "application/json")})
        assert r.status_code == 400
        assert "Group not found" in r.json()["detail"]
