import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Section, StatusPill } from "@/components/pv/primitives";
import { usePvQuery } from "@/lib/data-source";
import { products as productsApi } from "@/services/api/products";
import { demoProducts } from "@/services/demo/dataset";
import {
  allAlerts,
  registrations as registrationsApi,
  type AlertLevel,
} from "@/services/api/registrations";
import { buildCalendar } from "@/services/psur/own-brand-calendar";
import { todayIso } from "@/services/api/regulatory-clock";

const TONE: Record<AlertLevel, "critical" | "warning" | "info"> = {
  EXPIRED: "critical",
  CRITICAL: "critical",
  WARNING: "warning",
  NOTICE: "info",
};

interface Item {
  key: string;
  level: AlertLevel;
  daysLeft: number;
  text: string;
  to: "/registrations" | "/psur-calendar";
}

/** Registration renewals, commitments and own-brand PSURs coming due. */
export function RegulatoryDeadlinesCard() {
  const today = todayIso();
  const regQuery = useQuery({
    queryKey: ["registrations"],
    queryFn: () => registrationsApi.list(),
    retry: false,
  });
  const catalogQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );

  const items: Item[] = [
    ...allAlerts(regQuery.data ?? [], today).map((a) => ({
      key: a.key,
      level: a.level,
      daysLeft: a.daysLeft,
      text: `${a.productName}: ${a.title}`,
      to: "/registrations" as const,
    })),
    ...buildCalendar(catalogQuery.data?.data ?? [], today)
      .filter((e) => e.status === "OVERDUE" || e.status === "DUE_SOON")
      .map((e) => ({
        key: `psur:${e.drug.id}`,
        level: (e.status === "OVERDUE" ? "EXPIRED" : "CRITICAL") as AlertLevel,
        daysLeft: e.daysToDeadline ?? 0,
        text: `${e.drug.name}: PSUR (DLP ${e.nextDlp}) ${e.label.toLowerCase()}`,
        to: "/psur-calendar" as const,
      })),
  ].sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <Section
      title="Regulatory deadlines"
      description="Registration renewals, commitments and own-brand PSURs coming due."
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing due.{" "}
          <Link to="/registrations" className="text-primary hover:underline">
            Registrations
          </Link>{" "}
          ·{" "}
          <Link to="/psur-calendar" className="text-primary hover:underline">
            PSUR calendar
          </Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              <StatusPill tone={TONE[i.level]}>
                {i.daysLeft < 0 ? "Overdue" : `${i.daysLeft}d`}
              </StatusPill>
              <Link to={i.to} className="hover:underline">
                {i.text}
              </Link>
            </li>
          ))}
          {items.length > 8 ? (
            <li className="text-xs text-muted-foreground">and {items.length - 8} more</li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}
