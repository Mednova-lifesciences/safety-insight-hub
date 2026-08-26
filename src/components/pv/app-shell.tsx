import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  BriefcaseMedical,
  ChevronDown,
  ClipboardPlus,
  FileSpreadsheet,
  FileStack,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Radar,
  ShieldCheck,
  Timer,
} from "lucide-react";
import type { ReactNode } from "react";
import { ROLE_LABELS, useAuth, type Permission, type Role } from "@/lib/auth";
import { useDataSource } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "./primitives";
import { demoNotifications } from "@/services/demo/dataset";
import { notifications as notificationsApi } from "@/services/api/notifications";
import { usePvQuery } from "@/lib/data-source";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  permission?: Permission;
  hiddenForRoles?: Role[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/icsr/new", label: "New ICSR", icon: ClipboardPlus, permission: "case.create" },
      { to: "/cases", label: "Cases", icon: BriefcaseMedical, permission: "case.view" },
      { to: "/intake", label: "Inbound intake", icon: MessageSquare, permission: "intake.manage" },
      {
        to: "/whatsapp-intake",
        label: "WhatsApp intake",
        icon: MessageCircle,
        permission: "intake.manage",
      },
      { to: "/follow-ups", label: "Follow-ups", icon: Timer, permission: "case.view" },
    ],
  },
  {
    label: "Processing",
    items: [
      {
        to: "/line-list",
        label: "Line-list processing",
        icon: FileSpreadsheet,
        permission: "linelist.process",
        hiddenForRoles: ["PV_MANAGER", "PV_COORDINATOR"],
      },
      {
        to: "/e2b",
        label: "E2B(R3) preparation",
        icon: FileStack,
        permission: "e2b.generate",
        hiddenForRoles: ["PV_MANAGER", "PV_COORDINATOR"],
      },
      {
        to: "/psur",
        label: "PSUR / PBRER review",
        icon: FileText,
        permission: "psur.review",
        hiddenForRoles: ["PV_MANAGER", "PV_COORDINATOR"],
      },
    ],
  },
  {
    label: "Oversight",
    items: [
      { to: "/oversight", label: "Operational overview", icon: Gauge, permission: "team.view" },
      {
        to: "/literature",
        label: "Literature screening",
        icon: Newspaper,
        permission: "signal.view",
      },
      { to: "/signals", label: "Signal review", icon: Radar, permission: "signal.view" },
      { to: "/audit", label: "Audit trail", icon: Activity, permission: "audit.view.all" },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { backendConnected, demoData, setDemoData } = useDataSource();
  const notificationsQuery = usePvQuery(
    ["notifications"],
    () => notificationsApi.list(),
    () => demoNotifications,
  );
  const unread = notificationsQuery.data?.data.filter((n) => !n.read).length ?? 0;

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4">
          <ShieldCheck className="size-5 text-sidebar-primary" />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-sidebar-accent-foreground">MedNova</p>
            <p className="text-[11px] tracking-wide text-sidebar-foreground/70">PV ASSIST</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) =>
                (!i.permission || can(i.permission)) && !i.hiddenForRoles?.includes(user.role),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-4">
                <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-sidebar-foreground/50 uppercase">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active =
                      pathname === item.to || pathname.startsWith(`${item.to}/`);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                          {item.to === "/notifications" && unread > 0 ? (
                            <span className="mono-num ml-auto rounded bg-sidebar-primary px-1.5 text-[11px] text-sidebar-primary-foreground">
                              {unread}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-3 py-3 text-[11px] text-sidebar-foreground/70">
          <p className="font-medium text-sidebar-accent-foreground">AI assists. Rules validate.</p>
          <p>Humans decide. Every action is audited.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur">
          <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
            <ShieldCheck className="size-5 text-primary" />
            <span className="text-sm font-semibold">MedNova PV Assist</span>
          </Link>

          <div className="flex items-center gap-2">
            {backendConnected ? (
              <StatusPill tone="success">Backend connected</StatusPill>
            ) : (
              <StatusPill tone="warning">Backend not connected</StatusPill>
            )}
            {!backendConnected ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={demoData} onCheckedChange={setDemoData} aria-label="Show demo dataset" />
                Demo dataset
              </label>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/notifications" aria-label="Notifications">
                <Bell className="size-4" />
                {unread > 0 ? <span className="mono-num text-xs">{unread}</span> : null}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <span className="flex size-6 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground">
                    {user.initials}
                  </span>
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block text-xs font-medium">{user.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-0.5">
                  <p className="text-sm">{user.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user.organisation}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    // Await the full local sign-out before navigating —
                    // /auth bounces authenticated users back to the
                    // dashboard, so navigating mid-signout used to undo it.
                    await signOut();
                    navigate({ to: "/auth", replace: true });
                  }}
                >
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
