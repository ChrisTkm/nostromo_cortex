"""cortex_log — reference Python producer for Cortex Log Contract v2.

Usage:
    from cortex_log import execution, log

    with execution("cargas_sii", source="sap", target="mongo") as ctx:
        log.info("Connecting to SAP")
        log.info("Extracting rows", rows_read=5000, rows_inserted=5000)
        # exceptions are caught, an ERROR event is emitted, and the
        # exception is re-raised so the caller can handle it.

Writes one JSON object per line to:
    {CORTEX_LOG_DIR}/{process}/{process}_{date}.jsonl

Environment variables:
    CORTEX_LOG_DIR   target directory (default: see get_log_dir)
    CORTEX_PROCESS   default process name when not passed to execution()

This module never blocks the caller on I/O errors. If the file cannot be
written, the error is printed to stderr and execution continues.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Dict, Optional, Type

_LOG_DIR_VAR: ContextVar[Optional[str]] = ContextVar("_log_dir", default=None)
_EXECUTION_ID_VAR: ContextVar[Optional[str]] = ContextVar("_execution_id", default=None)
_PROCESS_VAR: ContextVar[Optional[str]] = ContextVar("_process", default=None)
_ENABLED_VAR: ContextVar[bool] = ContextVar("_enabled", default=True)

_DEFAULT_LOG_DIR = os.environ.get("CORTEX_LOG_DIR", os.path.join(os.getcwd(), ".cortex_logs"))


def get_log_dir() -> str:
    """Return the effective log directory."""
    override = _LOG_DIR_VAR.get()
    return override if override else _DEFAULT_LOG_DIR


def set_log_dir(path: str) -> None:
    """Override the log directory for the current context (e.g. in tests)."""
    _LOG_DIR_VAR.set(path)


def set_enabled(enabled: bool) -> None:
    """Enable or disable output (default True). Useful in tests to silence I/O."""
    _ENABLED_VAR.set(enabled)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_dir(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as exc:
        print(f"[cortex_log] failed to create directory {path}: {exc}", file=sys.stderr)


def _write(record: Dict[str, Any]) -> None:
    if not _ENABLED_VAR.get():
        return
    process = record.get("process", _PROCESS_VAR.get() or "unknown")
    log_dir = get_log_dir()
    proc_dir = os.path.join(log_dir, process)
    _ensure_dir(proc_dir)
    date = record["timestamp"][:10]
    filename = os.path.join(proc_dir, f"{process}_{date}.jsonl")
    try:
        with open(filename, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
    except OSError as exc:
        print(f"[cortex_log] failed to write {filename}: {exc}", file=sys.stderr)


def _make_record(
    level: str,
    event: str,
    message: str,
    *,
    process: Optional[str] = None,
    execution_id: Optional[str] = None,
    **extra: Any,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "timestamp": _timestamp(),
        "level": level,
        "process": process or _PROCESS_VAR.get() or "unknown",
        "event": event,
        "message": message,
    }
    eid = execution_id or _EXECUTION_ID_VAR.get()
    if eid:
        record["execution_id"] = eid
    for k, v in extra.items():
        if v is not None:
            record[k] = v
    return record


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def info(message: str, **extra: Any) -> None:
    """Emit an INFO event."""
    _write(_make_record("INFO", "INFO", message, **extra))


def warn(message: str, **extra: Any) -> None:
    """Emit a WARN event."""
    _write(_make_record("WARN", "WARN", message, **extra))


def error(message: str, **extra: Any) -> None:
    """Emit an ERROR event."""
    _write(_make_record("ERROR", "ERROR", message, **extra))


def step(message: str, **extra: Any) -> None:
    """Emit a STEP event."""
    _write(_make_record("INFO", "STEP", message, **extra))


# ---------------------------------------------------------------------------
# Execution context manager
# ---------------------------------------------------------------------------

class _Execution:
    """Context manager that emits BEGIN on enter and END on exit.

    If the body raises an exception, the END event carries level=ERROR and
    the exception is re-raised so the caller can handle it normally.
    """

    def __init__(
        self,
        process: str,
        *,
        execution_id: Optional[str] = None,
        **extra: Any,
    ) -> None:
        self._process = process
        self._execution_id = execution_id or uuid.uuid4().hex
        self._extra = extra
        self._start: Optional[datetime] = None

    def __enter__(self) -> "_Execution":
        self._start = datetime.now(timezone.utc)
        _EXECUTION_ID_VAR.set(self._execution_id)
        _PROCESS_VAR.set(self._process)
        _write(_make_record(
            "INFO", "BEGIN",
            "Execution started",
            process=self._process,
            execution_id=self._execution_id,
            **self._extra,
        ))
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> bool:
        elapsed = int((datetime.now(timezone.utc) - self._start).total_seconds() * 1000) if self._start else 0
        if exc_type is not None:
            tb = "".join(traceback.format_exception(exc_type, exc_val, exc_tb))
            _write(_make_record(
                "ERROR", "END",
                str(exc_val) if exc_val else "Execution failed",
                process=self._process,
                execution_id=self._execution_id,
                duration_ms=elapsed,
                error=tb,
                **self._extra,
            ))
        else:
            _write(_make_record(
                "INFO", "END",
                "Execution completed",
                process=self._process,
                execution_id=self._execution_id,
                duration_ms=elapsed,
                **self._extra,
            ))
        _EXECUTION_ID_VAR.set(None)
        _PROCESS_VAR.set(None)
        return False  # do not swallow the exception


def execution(process: str, **extra: Any) -> _Execution:
    """Create an execution span.

    Usage:
        with execution("cargas_sii", source="sap") as ctx:
            log.info("working")
            # ...

    On success: emits BEGIN + END with duration_ms.
    On exception: emits BEGIN + ERROR-level END with traceback,
    then re-raises.
    """
    return _Execution(process, **extra)


# Convenience alias so callers can write:  from cortex_log import execution, log
log = sys.modules[__name__]


# ---------------------------------------------------------------------------
# Smoke test (python -m cortex_log)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import tempfile

    tmp = tempfile.mkdtemp(prefix="cortex_log_test_")
    set_log_dir(tmp)
    print(f"Writing logs to {tmp}")

    with execution("smoke_test", source="cli") as ctx:
        log.info("Hello from cortex_log")
        log.step("Processing step 1")
        log.warn("Something worth noting")
        log.info("Done processing", rows_read=100)

    # Also test that errors don't break the module
    try:
        with execution("smoke_test_fail", source="cli") as ctx:
            raise ValueError("Intentional failure")
    except ValueError:
        pass

    print("Smoke test complete. Files written:")
    for root, dirs, files in os.walk(tmp):
        for f in files:
            path = os.path.join(root, f)
            with open(path) as fh:
                for line in fh:
                    print(f"  {path}: {line.rstrip()}")
