"use client";

import { useEffect, useState } from "react";

// A preference kept between visits: one of `choices` (the first is the default), read after the page has loaded so that the server and the
// browser agree on what they render first. A browser that refuses storage just forgets the choice.
export function usePersistedChoice<T extends string>(key: string, choices: readonly T[]): [T, (choice: T) => void] {
  const [choice, setChoice] = useState<T>(choices[0]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      const known = choices.find((candidate) => candidate === saved);
      if (known) setChoice(known);
    } catch {}
  }, [key, choices]);

  return [
    choice,
    (next) => {
      setChoice(next);
      try {
        localStorage.setItem(key, next);
      } catch {}
    },
  ];
}
