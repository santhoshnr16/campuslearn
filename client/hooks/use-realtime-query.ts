/**
 * useRealtimeQuery — drop-in replacement for ``useQuery`` that automatically
 * stays fresh via the SSE event stream.
 *
 * Usage:
 *
 *   const { data, isLoading } = useRealtimeQuery({
 *     queryKey: ['documents'],
 *     queryFn: () => documentsService.list(),
 *   });
 *
 * This is a thin wrapper: it calls ``useQuery`` as-is and relies on the
 * ``SSEProvider`` invalidating the matching query keys whenever a
 * ``table_change`` event arrives.  The benefit of a dedicated hook is that
 * you can set shorter ``staleTime`` / ``gcTime`` defaults here if you want
 * near-instant freshness for real-time screens, without affecting the global
 * QueryClient defaults.
 */

import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';

export function useRealtimeQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
>(
  options: UseQueryOptions<TQueryFnData, TError, TData>,
): UseQueryResult<TData, TError> {
  return useQuery<TQueryFnData, TError, TData>({
    // Very short stale time for real-time screens — the SSE layer will
    // invalidate as needed, so we mostly pay the refetch cost only when
    // something really changed.
    staleTime: 5_000,
    ...options,
  });
}
