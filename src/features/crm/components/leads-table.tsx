"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPhone } from "@/domain/shared/phone";
import { formatDate } from "@/domain/shared/dates";
import { NextContactBadge, StageLabel, TagChip } from "./chips";
import { WhatsAppButton } from "./whatsapp-button";
import { bulkAssignLeads } from "../actions";
import type { CrmLookups, LeadListItem } from "../types";

export function LeadsTable({
  rows,
  lookups,
  canAssign,
  userName,
}: {
  rows: LeadListItem[];
  lookups: CrmLookups;
  canAssign: boolean;
  userName: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const stageById = useMemo(() => new Map(lookups.pipelines.flatMap((p) => p.stages).map((s) => [s.id, s])), [lookups]);
  const ownerById = useMemo(() => new Map(lookups.owners.map((o) => [o.id, o.full_name || o.email])), [lookups]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assign() {
    startTransition(async () => {
      const res = await bulkAssignLeads({ leadIds: [...selected], ownerId: owner === "sem" ? null : owner });
      if (res.ok) {
        toast.success(res.message);
        setSelected(new Set());
      } else toast.error(res.message);
    });
  }

  const vars = (r: LeadListItem) => ({ nome: r.name, empresa: r.name, responsavel: userName });

  return (
    <div className="grid gap-2">
      {canAssign && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm" role="region" aria-label="Ações em massa">
          <span className="font-medium">{selected.size} selecionado(s)</span>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-48 bg-background" aria-label="Novo responsável">
              <SelectValue placeholder="Escolha o responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sem">Sem responsável</SelectItem>
              {lookups.owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.full_name || o.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={assign} disabled={!owner || pending}>
            <UserRoundCog aria-hidden="true" /> Atribuir
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Desktop: tabela */}
      <div className="hidden overflow-x-auto rounded-xl border bg-surface md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {canAssign && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Selecionar todos desta página"
                  />
                </TableHead>
              )}
              <TableHead>Lead</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Próxima ação</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Último contato</TableHead>
              <TableHead className="w-28">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const stage = r.deal ? stageById.get(r.deal.stage_id) : undefined;
              return (
                <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                  {canAssign && (
                    <TableCell>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Selecionar ${r.name}`} />
                    </TableCell>
                  )}
                  <TableCell className="max-w-72">
                    <Link href={`/crm/leads/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {[r.city, r.state].filter(Boolean).join(" – ")}
                      {r.segment && <span>· {r.segment.name}</span>}
                      {r.tags.slice(0, 3).map((t) => (
                        <TagChip key={t.id} name={t.name} color={t.color} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{stage ? <StageLabel name={stage.name} color={stage.color} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <NextContactBadge at={r.next_contact_at} compact />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatPhone(r.phone_e164) || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.owner_id ? ownerById.get(r.owner_id) ?? "—" : "Sem responsável"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.last_contact_at ? formatDate(r.last_contact_at) : "Nunca"}</TableCell>
                  <TableCell>
                    <WhatsAppButton
                      leadId={r.id}
                      dealId={r.deal?.id}
                      phone={r.whatsapp_e164}
                      vars={vars(r)}
                      templates={lookups.templates}
                      defaultMessage={lookups.whatsappDefault}
                      size="icon-sm"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Celular: lista de duas linhas */}
      <ul className="grid gap-2 md:hidden">
        {rows.map((r) => {
          const stage = r.deal ? stageById.get(r.deal.stage_id) : undefined;
          return (
            <li key={r.id} className="flex items-start gap-3 rounded-lg border bg-surface p-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <Link href={`/crm/leads/${r.id}`} className="truncate font-medium">
                  {r.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {[stage?.name, r.city].filter(Boolean).join(" · ")}
                </span>
                <NextContactBadge at={r.next_contact_at} compact />
              </div>
              <WhatsAppButton
                leadId={r.id}
                dealId={r.deal?.id}
                phone={r.whatsapp_e164}
                vars={vars(r)}
                templates={lookups.templates}
                defaultMessage={lookups.whatsappDefault}
                size="icon-sm"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
