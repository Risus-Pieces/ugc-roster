"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** The browser's UTC offset, so a datetime-local value is read in the user's timezone, not the server's. */
export function TzInput() {
  const tz = useSyncExternalStore(
    noop,
    () => String(new Date().getTimezoneOffset()),
    () => "",
  );
  return <input type="hidden" name="tz" value={tz} />;
}
