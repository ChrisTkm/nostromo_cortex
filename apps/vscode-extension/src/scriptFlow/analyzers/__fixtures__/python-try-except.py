import shutil
import tempfile
from pathlib import Path


def safe_copy(src: str, dst: str) -> bool:
    try:
        shutil.copy2(src, dst)
        return True
    except FileNotFoundError:
        return False
    except PermissionError:
        return False
    finally:
        tmp = tempfile.gettempdir()
        Path(tmp).mkdir(parents=True, exist_ok=True)
