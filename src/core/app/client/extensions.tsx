// This is the client half of Lamp's two compile-time extension mounts.
import { createIsomorphicFn } from "@tanstack/react-start";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { LampClientSlotContexts, LampClientSlots, OperatorSlotContext } from "../../api/extensions";

type ExtensionContextValue = OperatorSlotContext & { slots: LampClientSlots };
const ExtensionContext = createContext<ExtensionContextValue | null>(null);

const loadBuyerSlots = createIsomorphicFn()
  .client(async () => (await import("../../../ext/index.client")).lampClientSlots);

export function ClientExtensionProvider({ operatorId, slots, children }: { operatorId: string; slots?: LampClientSlots; children: ReactNode }) {
  const [resolvedSlots, setResolvedSlots] = useState<LampClientSlots>(slots ?? {});
  const [loadFailure, setLoadFailure] = useState<Error | null>(null);

  useEffect(() => {
    if (slots) {
      setResolvedSlots(slots);
      setLoadFailure(null);
      return;
    }
    const loaded = loadBuyerSlots();
    if (!loaded) {
      setLoadFailure(new Error("Lamp client extensions were unavailable during browser hydration."));
      return;
    }
    void loaded.then(
      (next) => setResolvedSlots(next),
      (cause: unknown) => setLoadFailure(cause instanceof Error ? cause : new Error("Lamp client extensions failed to load.")),
    );
  }, [slots]);

  if (loadFailure) throw loadFailure;
  return <ExtensionContext.Provider value={{ operatorId, slots: resolvedSlots }}>{children}</ExtensionContext.Provider>;
}

type ClientExtensionSlotProps<Name extends keyof LampClientSlotContexts> = {
  id: Name;
  context: Omit<LampClientSlotContexts[Name], keyof OperatorSlotContext>;
};

export function ClientExtensionSlot<Name extends keyof LampClientSlotContexts>({ id, context }: ClientExtensionSlotProps<Name>) {
  const mount = useContext(ExtensionContext);
  if (!mount) throw new Error(`Lamp client slot ${id} rendered outside the authenticated extension mount.`);
  const contribution = mount.slots[id] as LampClientSlots[Name];
  if (!contribution) return null;
  const slotContext = { operatorId: mount.operatorId, ...context } as unknown as LampClientSlotContexts[Name];
  return <>{contribution(slotContext)}</>;
}
