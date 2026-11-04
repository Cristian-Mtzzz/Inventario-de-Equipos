// Recuerda el último resultado mientras los argumentos sean los mismos (comparados con ===).
// Sirve para getters que filtran listas grandes: la plantilla los lee varias veces en cada
// detección de cambios y así solo se recalculan cuando cambia la lista o el texto buscado.
// Las listas deben reemplazarse (no modificarse en sitio) para que el cambio se note.
export function memoizeLast<A extends unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | undefined;
  let lastResult: R;
  return (...args: A): R => {
    if (lastArgs && args.length === lastArgs.length && args.every((arg, index) => arg === lastArgs![index])) {
      return lastResult;
    }
    lastResult = compute(...args);
    lastArgs = args;
    return lastResult;
  };
}
