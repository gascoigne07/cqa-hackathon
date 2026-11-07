import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FALLBACK_PROVIDERS, api } from "../api/cqa";
import type { ProviderInfo } from "../api/contract";

interface ProviderState {
  providers: ProviderInfo[];
  provider: ProviderInfo | null;
  setProvider: (id: string) => void;
}

const Ctx = createContext<ProviderState>({ providers: [], provider: null, setProvider: () => {} });
const KEY = "cqa.provider";

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Selected scoring provider (Cloud Gemini / Local Qwen3 / demo), remembered per browser. */
export function ProviderProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ["providers"], queryFn: api.providers, staleTime: 30_000 });
  const providers = q.data ?? FALLBACK_PROVIDERS;
  const [selected, setSelected] = useState<string | null>(readSaved);

  // fall back to the first available provider when the saved one is gone or unavailable
  useEffect(() => {
    if (!q.data) return;
    const current = q.data.find((p) => p.id === selected);
    if (!current || !current.available) {
      const first = q.data.find((p) => p.available);
      if (first) setSelected(first.id);
    }
  }, [q.data, selected]);

  const value = useMemo<ProviderState>(
    () => ({
      providers,
      provider: providers.find((p) => p.id === selected) ?? null,
      setProvider: (id) => {
        setSelected(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* storage unavailable */
        }
      },
    }),
    [providers, selected],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProvider = () => useContext(Ctx);
