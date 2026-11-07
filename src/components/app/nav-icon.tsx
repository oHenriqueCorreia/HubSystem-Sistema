import {
  BriefcaseBusiness,
  CalendarDays,
  ChartColumn,
  FileSignature,
  Filter,
  House,
  ListChecks,
  MapPinned,
  Repeat,
  Settings,
  UsersRound,
  Wallet,
  Building2,
  Megaphone,
  MessagesSquare,
  BellRing,
  type LucideProps,
} from "lucide-react";
import type { NavIcon } from "@/config/navigation";

const ICONS: Record<NavIcon, React.ComponentType<LucideProps>> = {
  home: House,
  leads: UsersRound,
  prospector: MapPinned,
  funnel: Filter,
  cadence: Repeat,
  clients: BriefcaseBusiness,
  contracts: FileSignature,
  calendar: CalendarDays,
  tasks: ListChecks,
  "finance-company": Building2,
  "finance-personal": Wallet,
  dashboard: ChartColumn,
  ads: Megaphone,
  reports: BellRing,
  inbox: MessagesSquare,
  settings: Settings,
};

export function NavIconView({ name, ...props }: { name: NavIcon } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" {...props} />;
}
