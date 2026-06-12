import json
import os


def process_payload(payload: str) -> dict:
    data = json.loads(payload)
    result = {}
    for key, value in data.items():
        result[key] = value
    return result


def not_covered() -> None:
    for i in range(1000000):
        _ = i * i
