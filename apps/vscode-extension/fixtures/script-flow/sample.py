def summarize_scores(scores):
    total = 0

    if not scores:
        return total

    for score in scores:
        try:
            total += normalize_score(score)
        except ValueError:
            log_invalid(score)

    return total
