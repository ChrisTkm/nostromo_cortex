# Abre este archivo en Script Flow para ver un warning de loop pass-only.
# Esperado: el for recibe una flecha/nota con color de loop.

def spin(items):
    for item in items:
        pass
