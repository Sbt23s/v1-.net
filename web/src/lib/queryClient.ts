import { QueryClient } from "@tanstack/react-query";

/**
 * How every screen in the portal decides whether what it is showing is still
 * true.
 *
 * <p>The settings here were tuned for the first paint and against everything
 * after it: refetchOnMount off, refetchOnWindowFocus off, and a five minute
 * staleTime. A page opened twice in five minutes was answered from cache
 * without asking the server, which is why a new claim did not appear in its
 * own table, a group somebody had just been added to stayed missing from Chat,
 * and an approval decided on one screen was still pending on another. Each was
 * reported as a separate bug; all of them were this.
 *
 * <p>It is also why invalidateQueries so often looked like it did nothing:
 * invalidation only refetches queries that are currently mounted, so marking a
 * list stale from the page that changed it did nothing at all, and arriving
 * back at that list, refetchOnMount was off and the stale cache answered
 * anyway.
 *
 * <p>The cache still does its job on the paint that matters. staleTime is
 * short rather than zero, so the twenty tiles on a dashboard mounting together
 * still share one answer, and cached data is shown immediately while the
 * refetch happens behind it -- the screen does not blank. What changes is that
 * opening a page, returning to the tab, or coming back from a dropped
 * connection now asks whether anything moved.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,

      // Coming back to the tab is exactly when somebody wants to know what
      // happened while they were elsewhere.
      refetchOnWindowFocus: true,

      // A reconnect means the gap is unknown, so nothing on screen can be
      // trusted to be current.
      refetchOnReconnect: true,

      /*
        Opening a page asks the server for anything it does not already hold
        fresh.

        This was "always", on the reasoning that plain `true` respects
        staleTime and would let a freshly-invalidated list answer from cache.
        It would not: invalidateQueries marks data stale, and a stale query
        refetches on mount under `true` exactly as it does under "always".
        What "always" additionally did was refetch every query on every mount
        regardless -- so returning to the dashboard fired all thirty-two of
        its queries again even if you had left it two seconds earlier.

        Everything that has to be immediate still is, because the code that
        changes data invalidates it: a leave request approved on one screen
        shows approved on the next, as before.
      */
      refetchOnMount: true,

      /*
        Thirty seconds, up from ten.

        Long enough that moving between pages does not re-ask for the same
        reference data over and over, short enough that nothing anyone reads
        is meaningfully behind. Anything that must be fresher says so on the
        query -- the live attendance and chat views set their own intervals,
        and every mutation invalidates what it touched.
      */
      staleTime: 30 * 1000,

      gcTime: 1000 * 60 * 30,

      /*
        A hidden tab asks for nothing.

        Fourteen of the fifteen polling queries in the app kept their timers
        running while the tab sat in the background, so a portal left open in
        a tab nobody was looking at went on requesting notifications, calendar
        events, complaints and chat all day. Polling resumes the moment the
        tab is looked at again, and refetchOnWindowFocus above means coming
        back is already a refresh -- so nothing is missed, it is just not
        fetched while there is no one to read it.
      */
      refetchIntervalInBackground: false,
    }
  }
});
