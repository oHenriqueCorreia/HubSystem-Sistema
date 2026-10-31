"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelative } from "@/domain/shared/dates";
import { listMyNotifications, markNotificationsRead, type NotificationItem } from "../actions";

const KEY = "hub:notificacoes-geradas";
const TEN_MIN = 10 * 60_000;

function shouldRefresh() {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < TEN_MIN) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sem storage: gera mesmo assim */
  }
  return true;
}

/** Central de notificações: lista, marca como lida e leva ao item. */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const unread = items.filter((i) => !i.read_at).length;

  const load = useCallback((refresh: boolean) => {
    startTransition(async () => {
      const res = await listMyNotifications({ refresh });
      if (res.ok) setItems(res.data as NotificationItem[]);
    });
  }, []);

  useEffect(() => {
    load(shouldRefresh());
  }, [load]);

  function read(ids?: string[]) {
    setItems((cur) => cur.map((i) => (!ids || ids.includes(i.id) ? { ...i, read_at: i.read_at ?? new Date().toISOString() } : i)));
    startTransition(async () => {
      await markNotificationsRead({ ids });
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notificações: ${unread} não lida(s)` : "Notificações"}>
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white tabular" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[min(22rem,calc(100vw-2rem))] gap-2 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notificações</h2>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => read()}>
              <CheckCheck aria-hidden="true" /> Marcar todas como lidas
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">Nenhuma notificação por enquanto.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto overscroll-contain pb-1">
            {items.map((n) => {
              const content = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className={cn("block text-sm", !n.read_at && "font-medium")}>{n.title}</span>
                    {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                    <span className="block text-xs text-muted-foreground">{formatRelative(n.created_at)}</span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => {
                        if (!n.read_at) read([n.id]);
                        setOpen(false);
                      }}
                      className="flex gap-2 px-3 py-2 hover:bg-accent"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => read([n.id])} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-accent">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
