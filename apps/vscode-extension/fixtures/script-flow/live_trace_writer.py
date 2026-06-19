from __future__ import annotations

import argparse
import time
from pathlib import Path

from instrumentation.scriptflow_trace import ScriptFlowTracer


FIXTURE_DIR = Path(__file__).resolve().parent
SCRIPT_PATH = FIXTURE_DIR / "sample.py"
DEFAULT_TRACE_PATH = FIXTURE_DIR / "sample.py.scriptflow.trace.jsonl"

# IDs copied from Script Flow for apps/vscode-extension/fixtures/script-flow/sample.py.
NODE_SUMMARIZE = "sf1:fn:summarize-scores:l1c1"
NODE_LOOP = "sf1:loop:for-score-in-scores:l7c5"
NODE_EXCEPT = "sf1:except:except-valueerror:l8c9"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write a slow Script Flow Live trace for sample.py."
    )
    parser.add_argument(
        "--trace-path",
        default=str(DEFAULT_TRACE_PATH),
        help="Trace output path. Defaults to sample.py.scriptflow.trace.jsonl.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.9,
        help="Seconds to sleep between writes so the Live watcher visibly updates.",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to the existing trace instead of starting from a clean file.",
    )
    args = parser.parse_args()

    trace_path = Path(args.trace_path).resolve()
    if not args.append and trace_path.exists():
        trace_path.unlink()

    tracer = ScriptFlowTracer(
        script_path=str(SCRIPT_PATH),
        trace_path=str(trace_path),
        run_id=f"live-demo-{int(time.time())}",
        script_hash="live-demo",
        machine_id="local-live-demo",
        process_id="python-live-writer",
    )

    print(f"[script-flow-live] writing {trace_path}")
    print("[script-flow-live] keep sample.py open in Script Flow to watch updates")

    tracer.start_run({"invocation": "python live_trace_writer.py"})
    time.sleep(args.delay)

    with tracer.span(NODE_SUMMARIZE, span_id="span-summarize"):
        print("[script-flow-live] summarize_scores span started")
        time.sleep(args.delay)

        loop = tracer.loop_aggregator(
            NODE_LOOP,
            span_id="span-loop",
            parent_span_id="span-summarize",
            flush_every_iterations=1000,
            metadata={"demo": True},
        )
        for batch in range(1, 4):
            loop.sample(duration_ms=12 + batch, iterations=1000)
            loop.flush(f"demo_batch_{batch}")
            print(f"[script-flow-live] loop_sample batch={batch}")
            time.sleep(args.delay)

        try:
            with tracer.span(
                NODE_EXCEPT,
                span_id="span-except",
                parent_span_id="span-summarize",
                metadata={"handled": True},
            ):
                print("[script-flow-live] emitting handled ValueError")
                time.sleep(args.delay)
                raise ValueError("demo invalid score")
        except ValueError:
            pass

        time.sleep(args.delay)

    tracer.end_run("ok", {"spans": 3, "handled_errors": 1, "loop_iterations": 3000})
    print("[script-flow-live] done")


if __name__ == "__main__":
    main()
