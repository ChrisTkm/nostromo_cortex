from __future__ import annotations

import json
import os
import socket
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator


TraceStatus = str


@dataclass
class ScriptFlowTracer:
    script_path: str
    trace_path: str | None = None
    run_id: str | None = None
    script_hash: str | None = None
    language: str = "python"
    machine_id: str | None = None
    process_id: str | int | None = None
    now: Callable[[], datetime] | None = None
    _started_at: float = field(default_factory=time.perf_counter, init=False)
    _sequence: int = field(default=0, init=False)
    _loops: list["ScriptFlowLoopAggregator"] = field(default_factory=list, init=False)
    _ended: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self.run_id = self.run_id or str(uuid.uuid4())
        self.machine_id = self.machine_id or socket.gethostname()
        self.process_id = self.process_id if self.process_id is not None else os.getpid()
        if self.trace_path is None:
            self.trace_path = f"{self.script_path}.scriptflow.trace.jsonl"

    def start_run(self, metadata: dict[str, Any] | None = None) -> None:
        self.write({"event": "run_start", "metadata": metadata})

    def end_run(self, status: TraceStatus = "ok", counters: dict[str, float] | None = None) -> None:
        if self._ended:
            return
        for loop in self._loops:
            loop.flush("run_end")
        self.write(
            {
                "event": "run_end",
                "duration_ms": round((time.perf_counter() - self._started_at) * 1000),
                "status": status,
                "counters": counters,
            }
        )
        self._ended = True

    @contextmanager
    def span(
        self,
        node_id: str,
        span_id: str | None = None,
        parent_span_id: str | None = None,
        entity_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Iterator[None]:
        span_id = span_id or self._next_span_id(node_id)
        started_at = time.perf_counter()
        self.write(
            {
                "event": "span_start",
                "entity_id": entity_id,
                "node_id": node_id,
                "parent_span_id": parent_span_id,
                "span_id": span_id,
                "metadata": metadata,
            }
        )
        try:
            yield
        except Exception as exc:
            self.write(
                {
                    "event": "span_error",
                    "entity_id": entity_id,
                    "node_id": node_id,
                    "parent_span_id": parent_span_id,
                    "span_id": span_id,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000),
                    "status": "error",
                    "metadata": {
                        **(metadata or {}),
                        "error": serialize_error(exc),
                    },
                }
            )
            raise
        else:
            self.write(
                {
                    "event": "span_end",
                    "entity_id": entity_id,
                    "node_id": node_id,
                    "parent_span_id": parent_span_id,
                    "span_id": span_id,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000),
                    "status": "ok",
                }
            )

    def loop_aggregator(
        self,
        node_id: str,
        span_id: str | None = None,
        parent_span_id: str | None = None,
        entity_id: str | None = None,
        flush_every_iterations: int = 1000,
        flush_every_ms: int = 2000,
        metadata: dict[str, Any] | None = None,
    ) -> "ScriptFlowLoopAggregator":
        loop = ScriptFlowLoopAggregator(
            tracer=self,
            node_id=node_id,
            entity_id=entity_id,
            span_id=span_id,
            parent_span_id=parent_span_id,
            flush_every_iterations=flush_every_iterations,
            flush_every_ms=flush_every_ms,
            metadata=metadata or {},
        )
        self._loops.append(loop)
        return loop

    def emit_loop_sample(
        self,
        node_id: str,
        iterations: int,
        sample_count: int,
        total_ms: float,
        max_ms: float,
        span_id: str | None = None,
        parent_span_id: str | None = None,
        entity_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if iterations <= 0 or sample_count <= 0:
            return
        self.write(
            {
                "event": "loop_sample",
                "entity_id": entity_id,
                "node_id": node_id,
                "parent_span_id": parent_span_id,
                "span_id": span_id,
                "counters": {
                    "iterations": iterations,
                    "sample_count": sample_count,
                    "total_ms": round(total_ms, 3),
                    "avg_ms": round(total_ms / iterations, 3),
                    "max_ms": round(max_ms, 3),
                },
                "metadata": metadata,
            }
        )

    def write(self, event: dict[str, Any]) -> None:
        trace_path = Path(str(self.trace_path))
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        with trace_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(compact(self._with_common_fields(event)), separators=(",", ":")) + "\n")

    def _with_common_fields(self, event: dict[str, Any]) -> dict[str, Any]:
        return {
            "version": 1,
            **event,
            "run_id": self.run_id,
            "timestamp": (self.now or utc_now)().isoformat().replace("+00:00", "Z"),
            "script_path": self.script_path,
            "script_hash": self.script_hash,
            "language": self.language,
            "machine_id": self.machine_id,
            "process_id": self.process_id,
        }

    def _next_span_id(self, node_id: str) -> str:
        self._sequence += 1
        return f"{node_id}:{self._sequence}"


@dataclass
class ScriptFlowLoopAggregator:
    tracer: ScriptFlowTracer
    node_id: str
    entity_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None
    flush_every_iterations: int = 1000
    flush_every_ms: int = 2000
    metadata: dict[str, Any] = field(default_factory=dict)
    _started_at: float = field(default_factory=time.perf_counter, init=False)
    _last_flush_at: float = field(default_factory=time.perf_counter, init=False)
    _iterations: int = field(default=0, init=False)
    _sample_count: int = field(default=0, init=False)
    _total_ms: float = field(default=0, init=False)
    _max_ms: float = field(default=0, init=False)

    def sample(self, duration_ms: float, iterations: int = 1) -> None:
        if iterations <= 0:
            return
        self._iterations += iterations
        self._sample_count += 1
        self._total_ms += duration_ms
        self._max_ms = max(self._max_ms, duration_ms)

        elapsed_ms = (time.perf_counter() - self._last_flush_at) * 1000
        if self._iterations >= self.flush_every_iterations or elapsed_ms >= self.flush_every_ms:
            self.flush("threshold")

    def measure(self, fn: Callable[[], Any], iterations: int = 1) -> Any:
        started_at = time.perf_counter()
        try:
            return fn()
        finally:
            self.sample((time.perf_counter() - started_at) * 1000, iterations)

    def flush(self, reason: str = "manual") -> None:
        if self._iterations <= 0 or self._sample_count <= 0:
            return
        self.tracer.emit_loop_sample(
            node_id=self.node_id,
            entity_id=self.entity_id,
            span_id=self.span_id,
            parent_span_id=self.parent_span_id,
            iterations=self._iterations,
            sample_count=self._sample_count,
            total_ms=self._total_ms,
            max_ms=self._max_ms,
            metadata={
                **self.metadata,
                "flush_reason": reason,
                "window_ms": round((time.perf_counter() - self._started_at) * 1000, 3),
            },
        )
        self._iterations = 0
        self._sample_count = 0
        self._total_ms = 0
        self._max_ms = 0
        self._last_flush_at = time.perf_counter()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def serialize_error(exc: Exception) -> dict[str, str]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "stack": "".join(traceback.format_exception(exc)).strip(),
    }


def compact(event: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if value is not None}
