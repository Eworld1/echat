import { useEffect, useRef } from 'react';

type BackAction = () => void;
const backActions = new Map<string, BackAction>();
const actionOrder: string[] = [];

export function useBackButton(enabled: boolean, action: BackAction, key: string) {
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    if (!enabled) return;
    backActions.set(key, () => actionRef.current());
    actionOrder.push(key);
    return () => {
      backActions.delete(key);
      const index = actionOrder.lastIndexOf(key);
      if (index >= 0) actionOrder.splice(index, 1);
    };
  }, [enabled, key]);
}

export function runTopBackAction(): boolean {
  for (let index = actionOrder.length - 1; index >= 0; index -= 1) {
    const action = backActions.get(actionOrder[index]);
    if (!action) continue;
    action();
    return true;
  }
  return false;
}
