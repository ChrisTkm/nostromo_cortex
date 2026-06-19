def normalize_value(value):
    try:
        return int(value)
    except Exception:
        return 0
