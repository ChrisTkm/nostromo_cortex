# Abre este archivo en Script Flow para ver un warning de except amplio.
# Esperado: el except recibe una flecha/nota con color de try/catch.

def normalize_value(value):
    try:
        return int(value)
    except Exception:
        return 0
