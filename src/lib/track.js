import { supabase } from "@/lib/supabase";

export function track(event, metadata = {}) {
  // Defer entirely off the current call stack so tracking never blocks or
  // interferes with React state updates / re-renders.
  setTimeout(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) =>
        supabase.from("events").insert({
          user_id:  session?.user?.id ?? null,
          event,
          metadata,
          url:      window.location.pathname,
          ts:       new Date().toISOString(),
        })
      )
      .catch(() => {});
  }, 0);
}
