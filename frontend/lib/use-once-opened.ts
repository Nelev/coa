"use client";

import { useState } from "react";

// Whether `open` has ever been true. A dialog is loaded the first time it is asked for, and then kept mounted so that it can close with its
// animation instead of vanishing: mount it while this is true. (The state is set during render, which React allows for exactly this.)
export function useOnceOpened(open: boolean): boolean {
  const [opened, setOpened] = useState(false);
  if (open && !opened) setOpened(true);
  return opened;
}
