import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ApiEnvelope, PageEnvelope, UserSummary } from "@/types";

/**
 * The company roster, fetched once and shared.
 *
 * <p>A dozen screens want the same list -- to fill an employee picker, to map
 * an id to a name, to count a department. Each had its own query key, so
 * React Query saw a dozen unrelated questions and made a dozen calls for one
 * answer: the whole directory downloaded again on every page that needs a
 * dropdown.
 *
 * <p>One key means the second screen to ask is served from the cache the
 * first one filled, for as long as the entry lives. Nothing else changes --
 * same endpoint, same data, same shape.
 *
 * <p>size=1000 because these are pickers and lookups: a missing row shows as
 * a blank name rather than an error, which is the kind of wrong that goes
 * unnoticed. If the company outgrows that, the fix is a search endpoint
 * behind the picker, not a larger number here.
 */
export function useRoster(enabled = true) {
  return useQuery({
    queryKey: ["roster"],
    enabled,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000"))
        .data.data.content ?? []
  });
}
