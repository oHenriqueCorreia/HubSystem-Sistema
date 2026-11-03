import type { PermissionKey } from "@/domain/permissions";

export type NavIcon =
  | "home"
  | "leads"
  | "prospector"
  | "funnel"
  | "cadence"
  | "clients"
  | "contracts"
  | "calendar"
  | "tasks"
  | "finance-company"
  | "finance-personal"
  | "dashboard"
  | "ads"
  | "inbox"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Basta ter uma destas permissões para ver o item. */
  anyOf?: PermissionKey[];
  /** Só para a conta dona da plataforma (private.workspace_creators). */
  platformOwner?: boolean;
  /** Aparece na barra inferior do celular. */
  mobile?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Trabalho",
    items: [
      { href: "/inicio", label: "Início", icon: "home", mobile: true },
      { href: "/tarefas", label: "Tarefas", icon: "tasks", anyOf: ["tasks.read"], mobile: true },
      { href: "/agenda", label: "Agenda", icon: "calendar", anyOf: ["calendar.read"], mobile: true },
      { href: "/conteudo", label: "Conteúdo", icon: "ads", anyOf: ["content.read"] },
      { href: "/anuncios", label: "Anúncios", icon: "ads", anyOf: ["ads.read"] },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/crm/leads", label: "Leads", icon: "leads", anyOf: ["crm.leads.read"], mobile: true },
      { href: "/crm/funil", label: "Funil", icon: "funnel", anyOf: ["crm.leads.read"] },
      { href: "/crm/prospectador", label: "Prospectador", icon: "prospector", anyOf: ["crm.leads.import"], platformOwner: true },
      { href: "/atendimento", label: "Atendimento", icon: "inbox", anyOf: ["inbox.read"] },
      { href: "/crm/cadencias", label: "Cadências", icon: "cadence", anyOf: ["crm.cadences.read"] },
      { href: "/clientes", label: "Clientes", icon: "clients", anyOf: ["clients.read"] },
      { href: "/contratos", label: "Contratos", icon: "contracts", anyOf: ["contracts.read"] },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { href: "/financeiro/empresa", label: "Empresa", icon: "finance-company", anyOf: ["finance.company.read"] },
      { href: "/financeiro/pessoal", label: "Pessoal", icon: "finance-personal", anyOf: ["finance.personal.manage"] },
    ],
  },
  {
    label: "Análise",
    items: [
      {
        href: "/dashboards",
        label: "Dashboards",
        icon: "dashboard",
        anyOf: ["dashboards.commercial", "dashboards.financial"],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/configuracoes", label: "Configurações", icon: "settings" };
