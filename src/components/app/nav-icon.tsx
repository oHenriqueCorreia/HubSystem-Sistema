import {
  BriefcaseBusiness,
  CalendarDays,
  ChartColumn,
  FileSignature,
  Filter,
  House,
  ListChecks,
  Repeat,
  Settings,
  UsersRound,
  Wallet,
  Building2,
  type LucideProps,
} from "lucide-react";
import type { NavIcon } from "@/config/navigation";

const ICONS: Record<NavIcon, React.ComponentType<LucideProps>> = {
  home: House,
  leads: UsersRound,
  funnel: Filter,
  cadence: Repeat,
  clients: BriefcaseBusiness,
  contracts: FileSignature,
  calendar: CalendarDays,
  tasks: ListChecks,
  "finance-company": Building2,
  "finance-personal": Wallet,
  dashboard: ChartColumn,
  settings: Settings,
};

export function NavIconView({ name, ...props }: { name: NavIcon } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" {...props} />;
}
