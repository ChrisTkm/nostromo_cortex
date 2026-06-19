# Flow-gap "sección sin cerrar": la función no termina en return.
# Script Flow marca el nodo con un flow-gap ("no explicit return").
#
# Contraste a propósito: `normalize_score` SÍ cierra (tiene return); `summarize`
# queda abierta para que el analyzer muestre el hueco.

def summarize(scores):
    total = 0

    for score in scores:
        total += normalize_score(score)

    # sin return -> el flujo de summarize queda abierto


def normalize_score(score):
    return max(0, min(100, score))
