from instrumentation.scriptflow_trace import ScriptFlowTracer


tracer = ScriptFlowTracer(
    script_path=__file__,
    machine_id="local-dev",
)

# Copy these from the Script Flow node IDs for the final instrumented script.
NODE_SUMMARIZE = "sf1:fn:summarize_scores:l24c1"
NODE_LOOP = "sf1:loop:for-score-in-scores:l37c9"
NODE_EXCEPT = "sf1:except:except-valueerror:l42c13"


def normalize_score(score):
    if score < 0:
        raise ValueError("score must be positive")
    return score


def log_invalid(score):
    print(f"invalid score: {score}")


def summarize_scores(scores):
    with tracer.span(NODE_SUMMARIZE, span_id="span-summarize"):
        total = 0

        if not scores:
            return total

        loop = tracer.loop_aggregator(
            NODE_LOOP,
            span_id="span-loop",
            parent_span_id="span-summarize",
            flush_every_iterations=1000,
        )
        for score in scores:
            try:
                loop.measure(lambda: normalize_score(score))
                total += score
            except ValueError:
                with tracer.span(
                    NODE_EXCEPT,
                    span_id=f"span-invalid-{score}",
                    parent_span_id="span-summarize",
                ):
                    log_invalid(score)
        loop.flush("loop_exit")

        return total


if __name__ == "__main__":
    tracer.start_run({"invocation": "python instrumented_sample.py"})
    run_status = "ok"
    try:
        summarize_scores([1, 2, -1, 3])
    except Exception:
        run_status = "error"
        raise
    finally:
        tracer.end_run(run_status)
