"use client";

import { NotificationBell } from "@/features/notifications/components/notification-bell";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { LogOut, Menu, Monitor, Moon, Sun, UserRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Brand, BrandMark } from "@/components/app/brand";
import { KeepActiveVisible } from "@/components/app/keep-active-visible";
import { MobileTables } from "@/components/app/mobile-tables";
import { NavIconView } from "@/components/app/nav-icon";
import { signOut } from "@/features/auth/actions";
import type { NavGroup, NavItem } from "@/config/navigation";
import { cn } from "cn";

export type ShellUser = { fullName: string; email: string; roleNames: string[] };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AppShell({
  groups,
  settings,
  user,
  organizationName,
  defaultOpen,
  children,
}: {
  groups: NavGroup[];
  settings: NavItem | null;
  user: ShellUser;
  organizationName: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>

      <Sidebar collapsible="icon" aria-label="Navegação principal">
        <SidebarHeader>
          <Link href="/inicio" className="flex items-center gap-2 rounded-md p-1.5 outline-none">
            <BrandMark className="hidden size-7 shrink-0 group-data-[collapsible=icon]:inline-block" />
            <span className="grid leading-tight group-data-[collapsible=icon]:hidden">
              <Brand className="h-9 w-36" />
              <span className="truncate text-xs text-muted-foreground">{organizationName}</span>
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <NavIconView name={item.icon} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            {settings && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive(pathname, settings.href)} tooltip={settings.label}>
                  <Link href={settings.href}>
                    <NavIconView name={settings.icon} />
                    <span>{settings.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <UserMenu user={user} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <KeepActiveVisible />
        <MobileTables />
        <div className="hub-topbar sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur">
          <SidebarTrigger aria-label="Recolher ou expandir menu" className="hidden md:inline-flex" />
          <Link href="/inicio" aria-label="Ir para o início" className="flex min-h-11 min-w-0 items-center gap-2 md:hidden">
            <BrandMark className="size-7 shrink-0" />
            <span className="truncate text-sm font-medium">{organizationName}</span>
          </Link>
          <div className="ml-auto shrink-0">
            <NotificationBell />
          </div>
        </div>
        <div id="conteudo" tabIndex={-1} className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
          {children}
        </div>
        <MobileNav groups={groups} settings={settings} user={user} pathname={pathname} />
      </SidebarInset>
    </SidebarProvider>
  );
}

function UserMenu({ user, compact }: { user: ShellUser; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button type="button" className="rounded-full" aria-label="Menu da conta">
            <Avatar className="size-8">
              <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
            </Avatar>
          </button>
        ) : (
          <SidebarMenuButton size="lg" tooltip="Sua conta" aria-label="Menu da conta">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials(user.fullName)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 text-left leading-tight">
              <span className="truncate text-sm font-medium">{user.fullName}</span>
              <span className="truncate text-xs text-muted-foreground">{user.roleNames.join(", ")}</span>
            </span>
          </SidebarMenuButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="grid font-normal">
          <span className="font-medium">{user.fullName}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/configuracoes/perfil">
            <UserRound aria-hidden="true" /> Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun aria-hidden="true" /> Tema
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun aria-hidden="true" /> Claro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon aria-hidden="true" /> Escuro
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor aria-hidden="true" /> Igual ao sistema
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mostra na hora que o toque foi recebido, mesmo se a tela demorar a chegar. */
function NavPending() {
  const { pending } = useLinkStatus();
  return <span className={cn("absolute inset-x-5 top-0 h-0.5 rounded-b bg-primary transition-opacity", pending ? "opacity-100" : "opacity-0")} aria-hidden="true" />;
}

/** Barra inferior do celular: 4 destinos principais + "Mais". */
function MobileNav({
  groups,
  settings,
  user,
  pathname,
}: {
  groups: NavGroup[];
  settings: NavItem | null;
  user: ShellUser;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.items);
  const primary = all.filter((i) => i.mobile).slice(0, 4);
  const moreActive = !primary.some((i) => isActive(pathname, i.href));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="hub-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-muted",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <NavPending />
                  <NavIconView name={item.icon} className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              className={cn(
                "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                moreActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Menu className="size-5" aria-hidden="true" />
              Mais
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="grid gap-5 px-4 pb-4">
            {groups.map((group) => (
              <section key={group.label} aria-labelledby={`m-${group.label}`}>
                <h2 id={`m-${group.label}`} className="mb-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="grid grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={isActive(pathname, item.href) ? "page" : undefined}
                        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                      >
                        <NavIconView name={item.icon} className="size-4" />
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex items-center justify-between border-t pt-4">
              {settings ? (
                <Link
                  href={settings.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
                >
                  <NavIconView name={settings.icon} className="size-4" />
                  {settings.label}
                </Link>
              ) : (
                <span />
              )}
              <UserMenu user={user} compact />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
