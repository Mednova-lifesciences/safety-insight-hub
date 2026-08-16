import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isApiConfigured, isNotConfigured } from "@/services/api/client";

/**
 * Data provenance control.
 *
 * `live`  — the value came from the FastAPI layer wrapping the Python engines.
 * `demo`  — the backend is not connected and the seeded demonstration dataset
 *           is being displayed so the interface can be reviewed.
 *
 * There is no third state where fabricated values are presented as real
 * results: when demo data is switched off, unconnected screens render an
 * explicit "pending integration" panel.
 */

export type DataSource = "live" | "demo";

interface DataSourceState {
  backendConnected: boolean;
  demoData: boolean;
  setDemoData: (v: boolean) => void;
}

const Ctx = createContext<DataSourceState | null>(null);
const KEY = "mednova.pv.demoData";

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [demoData, setDemoDataState] = useState(true);

  useEffect(() => {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) setDemoDataState(raw === "true");
  }, []);

  const setDemoData = useCallback((v: boolean) => {
    window.localStorage.setItem(KEY, String(v));
    setDemoDataState(v);
  }, []);

  const value = useMemo(
    () => ({ backendConnected: isApiConfigured(), demoData, setDemoData }),
    [demoData, setDemoData],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDataSource(): DataSourceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDataSource must be used inside <DataSourceProvider>");
  return ctx;
}

export interface PvResult<T> {
  data: T;
  source: DataSource;
}

/**
 * Query helper: calls the real endpoint first. If the backend is not
 * configured it either returns the seeded demo value (tagged `demo`) or
 * rethrows so the caller can render the unavailable state.
 */
export function usePvQuery<T>(
  key: unknown[],
  fetcher: () => Promise<T>,
  demoValue: () => T,
): UseQueryResult<PvResult<T>, Error> {
  const { demoData } = useDataSource();
  return useQuery<PvResult<T>, Error>({
    queryKey: [...key, demoData],
    queryFn: async () => {
      try {
        return { data: await fetcher(), source: "live" as const };
      } catch (err) {
        if (isNotConfigured(err) && demoData) {
          return { data: demoValue(), source: "demo" as const };
        }
        throw err;
      }
    },
    retry: false,
  });
}
