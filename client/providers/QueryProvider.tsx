/**
 * React Query provider — single QueryClient shared across the app.
 *
 * Import ``queryClient`` wherever you need to imperatively interact with the
 * cache (e.g. from the SSE event handler).
 */

import React from 'react';
import { QueryClient, QueryClientProvider as RQProvider } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data fresh for 30 s after a fetch; SSE events will invalidate
      // sooner when there are real changes.
      staleTime: 30_000,
      // Retry once on failure, then let the UI show the error state.
      retry: 1,
      // Refetch when the app comes back to the foreground (belt-and-suspenders
      // alongside the SSE reconnect).
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <RQProvider client={queryClient}>{children}</RQProvider>;
}
