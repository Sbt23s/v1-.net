import { useEffect, useState } from "react";

/**
 * A value that settles before anything acts on it.
 *
 * <p>For search boxes whose text is part of a query key. Typing "balaji" is
 * six renders, and with the raw value in the key that is six query keys, six
 * requests and six full-table searches, of which the first five are answers
 * nobody will read. This holds the value still until the typing stops.
 *
 * <p>250ms: long enough to swallow the middle of a word, short enough that
 * the results feel like they are keeping up. Below about 150 the saving
 * disappears; above about 400 it starts to feel like lag.
 *
 * <p>Only for text that reaches the server. A search filtering a list the
 * browser already holds should stay immediate -- there is nothing to save,
 * and a delay there is just a slower page.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    // Every keystroke cancels the previous timer, so only the last one fires.
    return () => clearTimeout(t);
  }, [value, delay]);

  return settled;
}
