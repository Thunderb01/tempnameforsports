"""
Retry wrapper for Supabase/PostgREST queries.

Why: supabase-py sends every request over one long-lived HTTP/2 connection,
and Supabase's gateway closes a connection after ~10,000 requests (an HTTP/2
GOAWAY with error_code 0, last_stream_id 19999). httpx/postgrest don't retry,
so the next request raises httpx.RemoteProtocolError and a long pipeline run
(torvik_metrics.py makes 2-3 requests per player) crashes partway through.

The connection pool drops the dead connection on its own, so simply
re-executing the same query builder opens a fresh connection and succeeds.

Usage:
    from db_retry import run_query
    res = run_query(db.table("players").select("id").range(0, 999))
"""

import time

import httpx

# Only errors where the request is known (or near-certain) not to have been
# processed server-side: a GOAWAY'd/terminated connection, or one that never
# got established. Read timeouts are deliberately NOT retried — the server may
# have already applied a write, and re-sending an insert could duplicate it.
RETRYABLE = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
)


def run_query(query, attempts: int = 5, base_delay: float = 0.5):
    """Call query.execute(), retrying transient connection errors with backoff."""
    for attempt in range(1, attempts + 1):
        try:
            return query.execute()
        except RETRYABLE as e:
            if attempt == attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            print(f"  ! Supabase connection dropped ({type(e).__name__}); "
                  f"retrying in {delay:.1f}s (attempt {attempt + 1}/{attempts})")
            time.sleep(delay)
