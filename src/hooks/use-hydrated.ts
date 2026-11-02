import * as React from "react";

const subscribe = () => () => {};

/** Falso no HTML do servidor e verdadeiro depois que o React assumiu a página. */
export function useHydrated() {
  return React.useSyncExternalStore(subscribe, () => true, () => false);
}
