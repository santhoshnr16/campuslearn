/**
 * SSEProvider — global Server-Sent Events connection that:
 *
 *  1. Connects to ``/api/v1/events`` with the user's JWT.
 *  2. Reconnects automatically on errors / network drops (exponential back-off).
 *  3. Disconnects when the app goes to background, reconnects on foreground.
 *  4. Reacts to auth state — connects on login, disconnects on logout.
 *  5. Dispatches incoming ``table_change`` events to React Query, either
 *     invalidating queries or patching the cache directly.
 *
 * Wrap your authenticated app tree with ``<SSEProvider>`` — it reads the
 * access token from ``tokenStorage`` so it stays in sync with the axios
 * interceptor refresh flow.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import EventSource from 'react-native-sse';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

// Custom SSE event names that the backend sends.
type SSECustomEvents = 'connected' | 'table_change';

import { API_BASE_URL, tokenStorage } from '@/services/api';
import { queryClient } from '@/providers/QueryProvider';
import { useAuthStore } from '@/stores/authStore';

// ── Types ────────────────────────────────────────────────────────────────

export interface TableChangeEvent {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  user_id: string | null;
  ts: number;
}

interface SSEContextValue {
  /** True once the SSE stream has received the ``connected`` event. */
  isConnected: boolean;
}

const SSEContext = createContext<SSEContextValue>({ isConnected: false });

export const useSSE = () => useContext(SSEContext);

// ── Query-key mapping ────────────────────────────────────────────────────
//
// Maps a PG table name to React Query query-key prefixes that should be
// invalidated when that table changes.  Add entries here as you add new
// queries throughout the app.

const TABLE_QUERY_KEY_MAP: Record<string, string[][]> = {
  documents:           [['documents']],
  questions:           [['questions'], ['sessions']],
  generation_sessions: [['sessions'], ['questions']],
  subjects:            [['subjects']],
  topics:              [['topics'], ['subjects']],
  rubrics:             [['rubrics']],
  tests:               [['tests']],
  test_questions:      [['tests']],
  test_submissions:    [['tests'], ['submissions']],
  enrollments:         [['enrollments'], ['learn']],
  student_progress:    [['progress'], ['learn'], ['leaderboard']],
};

// ── Event dispatcher ─────────────────────────────────────────────────────

function handleTableChange(event: TableChangeEvent) {
  const queryKeys = TABLE_QUERY_KEY_MAP[event.table];
  if (!queryKeys) return;

  for (const key of queryKeys) {
    queryClient.invalidateQueries({
      queryKey: key,
      // Only refetch queries with active observers (mounted components).
      // Inactive queries are marked stale and will refetch on next mount.
      refetchType: 'active',
    });
  }

  // Optimistic DELETE — remove item from list caches immediately
  if (event.op === 'DELETE') {
    for (const key of queryKeys) {
      queryClient.setQueriesData<any[]>(
        { queryKey: key },
        (oldData) => {
          if (!Array.isArray(oldData)) return oldData;
          return oldData.filter((item: any) => item.id !== event.id);
        },
      );
    }
  }
}

// ── Provider component ───────────────────────────────────────────────────

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const esRef = useRef<EventSource<SSECustomEvents> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = React.useState(false);
  const mountedRef = useRef(true);

  // Subscribe to auth state so we connect/disconnect on login/logout
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ── Imperative helpers (refs to avoid stale closures) ─────────────────

  const disconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
  };

  const scheduleReconnect = () => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) return; // already scheduled

    const delay = backoffRef.current;
    console.log(`[SSE] Reconnecting in ${delay}ms …`);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      connectSSE();
    }, delay);
  };

  const connectSSE = async () => {
    // Guard: don't double-connect, don't connect if unmounted
    if (esRef.current || !mountedRef.current) return;

    const token = await tokenStorage.getAccessToken();
    if (!token) return; // not authenticated

    const url = `${API_BASE_URL}/events`;

    const es = new EventSource<SSECustomEvents>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      pollingInterval: 0,
    });

    esRef.current = es;

    es.addEventListener('connected', () => {
      console.log('[SSE] Connected');
      setIsConnected(true);
      backoffRef.current = INITIAL_BACKOFF_MS;
    });

    es.addEventListener('table_change', (msg) => {
      if (!msg?.data) return;
      try {
        const event: TableChangeEvent = JSON.parse(msg.data);
        handleTableChange(event);
      } catch (err) {
        console.warn('[SSE] Failed to parse table_change:', err);
      }
    });

    es.addEventListener('error', (err) => {
      console.warn('[SSE] Error, will reconnect:', err);
      disconnect();
      scheduleReconnect();
    });

    es.addEventListener('close', () => {
      console.log('[SSE] Connection closed');
      disconnect();
      scheduleReconnect();
    });
  };

  // ── React to auth state ───────────────────────────────────────────────
  // Connect when authenticated, disconnect + cancel reconnects when not.

  useEffect(() => {
    if (isAuthenticated) {
      connectSSE();
    } else {
      disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── AppState: disconnect on background, reconnect on foreground ───────

  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasPrev = prev;
      prev = nextState;

      if (!isAuthenticated) return;

      if (nextState === 'active' && wasPrev !== 'active') {
        console.log('[SSE] App foregrounded — reconnecting');
        connectSSE();
      } else if (nextState.match(/inactive|background/) && wasPrev === 'active') {
        console.log('[SSE] App backgrounded — disconnecting');
        disconnect();
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── Network state: reconnect when connectivity is restored ────────────

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && !esRef.current && mountedRef.current && isAuthenticated) {
        console.log('[SSE] Network restored — reconnecting');
        connectSSE();
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── Mount / unmount cleanup ───────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <SSEContext.Provider value={{ isConnected }}>
      {children}
    </SSEContext.Provider>
  );
}
