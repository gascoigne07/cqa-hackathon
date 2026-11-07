import os
import shutil
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="cqa-test-"))
_seed = Path(__file__).resolve().parent.parent / "data" / "dev.json"
_fixture = Path(__file__).resolve().parent / "fixtures" / "sample.json"

os.environ["CQA_DATA_DIR"] = str(_tmp)
os.environ["CQA_SEED_FILE"] = str(_seed if _seed.exists() else _fixture)
os.environ["CQA_MOCK_DELAY"] = "0"
os.environ["CQA_DEFAULT_PROVIDER"] = "mock"
os.environ["CQA_FRONTEND_DIST"] = str(_tmp / "no-frontend")


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    shutil.rmtree(_tmp, ignore_errors=True)
