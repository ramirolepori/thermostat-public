import { useState, useCallback } from 'react';

/**
 * useApiRequest - Centraliza loading, error y ejecución de peticiones async.
 * @param apiFn - función async que retorna una promesa
 * @returns [run, { loading, error, data }]
 */
export function useApiRequest<T = any, Args extends any[] = any[]>(
  apiFn: (...args: Args) => Promise<T>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  const run = useCallback(
    async (...args: Args) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFn(...args);
        setData(result);
        return result;
      } catch (e: any) {
        setError(e?.message || 'Error desconocido');
        setData(null);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [apiFn]
  );

  return [run, { loading, error, data }] as const;
}
