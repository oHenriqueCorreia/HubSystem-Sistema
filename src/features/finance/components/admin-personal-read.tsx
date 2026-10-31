"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert } from "@/components/app/form-field";
import { formatBRL } from "@/domain/shared/money";
import { formatDate, todayLocal } from "@/domain/shared/dates";
import { addMonthsCivil } from "@/domain/finance";
import { adminReadPersonal } from "../actions";
import { KIND_LABEL, STATUS_LABEL, type TxnKind, type TxnStatus } from "../types";

type Row = { id: string; kind: string; description: string; amount_cents: number; status: string; due_date: string; paid_at: string | null; category: string | null; account: string | null };

export function AdminPersonalRead({ users }: { users: { id: string; name: string }[] }) {
  const [user, setUser] = useState("");
  const [from, setFrom] = useState(addMonthsCivil(todayLocal(), -1));
  const [to, setTo] = useState(todayLocal());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-4">
      <p className="flex max-w-prose items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        Cada consulta fica registrada na auditoria e aparece para a própria pessoa. Use somente quando houver necessidade justificada.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="ar-user">Usuário</Label>
          <Select value={user} onValueChange={setUser}>
            <SelectTrigger id="ar-user" className="w-56">
              <SelectValue placeholder="Escolha o usuário" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ar-from">De</Label>
          <Input id="ar-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ar-to">Até</Label>
          <Input id="ar-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <Button
          disabled={!user || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await adminReadPersonal({ userId: user, from, to });
              if (!res.ok) {
                setError(res.message);
                setRows(null);
              } else setRows(res.data.transactions);
            })
          }
        >
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Consultar
        </Button>
      </div>
      <FormAlert>{error}</FormAlert>
      {rows &&
        (rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento no período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell>{KIND_LABEL[r.kind as TxnKind]}</TableCell>
                    <TableCell>{r.category ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(r.amount_cents)}</TableCell>
                    <TableCell>{STATUS_LABEL[r.status as TxnStatus]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
    </div>
  );
}
