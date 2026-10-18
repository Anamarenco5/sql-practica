// Límite de pedidos en memoria (ventana fija por minuto). Alcanza para un solo servidor.
export function rateLimiter(maxPerMinute: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  // limpieza periódica para que el mapa no crezca indefinidamente
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60_000).unref();
  /** Devuelve los segundos a esperar si se pasó del límite, o 0 si puede seguir. */
  return (key: string): number => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.set(key, { count: 1, reset: now + 60_000 });
      return 0;
    }
    h.count++;
    return h.count > maxPerMinute ? Math.ceil((h.reset - now) / 1000) : 0;
  };
}
