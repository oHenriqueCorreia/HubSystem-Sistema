"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { EmptyState } from "@/components/app/states";
import { formatDateTime } from "@/domain/shared/dates";
import { ACTION_LABELS, TRIGGERS, type AutomationAction, type AutomationCondition, type TriggerKey } from "@/domain/whatsapp/automations";
import { deleteAutomation, saveAutomation, toggleAutomation } from "../ops-actions";

type Automation = { id: string; name: string; enabled: boolean; trigger: TriggerKey; condition: AutomationCondition; actions: AutomationAction[]; delay_minutes: number };
type Problem = { id: string; automation_id: string; status: string; detail: string | null; created_at: string };
type Option = { id: string; name: string };
type Lookups = { owners: { id: string; full_name: string; email: string }[]; tags: Option[]; stages: Option[] };

const BLANK: Record<AutomationAction["type"], AutomationAction> = {
  enviar_texto: { type: "enviar_texto", body: "" },
  atribuir: { type: "atribuir", userId: "" },
  etiquetar: { type: "etiquetar", tagId: "" },
  criar_tarefa: { type: "criar_tarefa", title: "", dueHours: 24 },
  notificar: { type: "notificar", title: "" },
};

export function AutomationsPanel({ automations, problems, owners, tags, stages }: { automations: Automation[]; problems: Problem[] } & Lookups) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lookups = { owners, tags, stages };
  const nameOf = (id: string) => automations.find((a) => a.id === id)?.name ?? "Automação apagada";

  return (
    <div className="grid gap-4">
      <div>
        <AutomationDialog {...lookups} trigger={<Button><Plus aria-hidden="true" /> Nova automação</Button>} />
      </div>
      {automations.length === 0 ? (
        <EmptyState icon={Workflow} title="Nenhuma automação ainda" description="Por exemplo: quando chegar uma mensagem com a palavra preço, passar para um responsável e colocar uma etiqueta." />
      ) : (
        <ul className="grid gap-2">
          {automations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 text-sm">
              <Switch
                checked={a.enabled}
                disabled={pending}
                aria-label={a.enabled ? `Desligar ${a.name}` : `Ligar ${a.name}`}
                onCheckedChange={(enabled) =>
                  startTransition(async () => {
                    const res = await toggleAutomation({ id: a.id, enabled });
                    if (res.ok) toast.success(res.message);
                    else toast.error(res.message);
                    router.refresh();
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{a.name}</p>
                <p className="text-xs break-words text-muted-foreground">
                  Quando: {TRIGGERS[a.trigger]}
                  {a.condition.keyword ? `, com a palavra "${a.condition.keyword}"` : ""}
                  {a.delay_minutes ? `, depois de ${a.delay_minutes} min` : ""}. Então: {a.actions.map((x) => ACTION_LABELS[x.type].toLowerCase()).join(", ")}.
                </p>
              </div>
              <AutomationDialog {...lookups} automation={a} trigger={<Button size="sm" variant="outline">Editar</Button>} />
              <ConfirmDialog
                tone="danger"
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Apagar ${a.name}`}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                }
                title="Apagar esta automação?"
                description="Ela para de rodar e o histórico dela é apagado."
                confirmLabel="Apagar"
                onConfirm={async () => {
                  const res = await deleteAutomation({ id: a.id });
                  if (res.ok) toast.success(res.message);
                  else toast.error(res.message);
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <section aria-labelledby="automacao-problemas" className="grid gap-2">
          <h2 id="automacao-problemas" className="text-sm font-semibold">
            O que não rodou
          </h2>
          <ul className="grid gap-1 text-sm">
            {problems.map((p) => (
              <li key={p.id} className="rounded-md border bg-surface px-3 py-2">
                <span className="font-medium">{nameOf(p.automation_id)}</span>
                <span className="text-muted-foreground"> em {formatDateTime(p.created_at)}: </span>
                <span className="break-words">{p.detail ?? (p.status === "bloqueado" ? "bloqueada" : "falhou")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AutomationDialog({ automation, trigger, owners, tags, stages }: { automation?: Automation; trigger: React.ReactNode } & Lookups) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(automation?.name ?? "");
  const [when, setWhen] = useState<TriggerKey>(automation?.trigger ?? "mensagem_recebida");
  const [keyword, setKeyword] = useState(automation?.condition.keyword ?? "");
  const [stageId, setStageId] = useState(automation?.condition.stageId ?? "");
  const [noAssignee, setNoAssignee] = useState(Boolean(automation?.condition.noAssignee));
  const [delay, setDelay] = useState(String(automation?.delay_minutes ?? 0));
  const [actions, setActions] = useState<AutomationAction[]>(automation?.actions ?? [BLANK.enviar_texto]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patch = (i: number, next: AutomationAction) => setActions((list) => list.map((a, j) => (j === i ? next : a)));

  function submit() {
    setError(null);
    const condition: AutomationCondition = {
      ...(when === "mensagem_recebida" && keyword.trim() ? { keyword: keyword.trim() } : {}),
      ...(when === "etapa_alterada" && stageId ? { stageId } : {}),
      ...(noAssignee ? { noAssignee: true } : {}),
    };
    startTransition(async () => {
      const res = await saveAutomation({ id: automation?.id, name, trigger: when, condition, actions, delayMinutes: Number(delay) || 0 });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{automation ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>Mensagens automáticas respeitam quem pediu para sair. Para quem nunca escreveu, é preciso ter a autorização registrada no lead.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Quando">
            <Select value={when} onValueChange={(v) => setWhen(v as TriggerKey)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGERS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {when === "mensagem_recebida" && (
            <FormField label="Se a mensagem tiver a palavra" optional>
              <Input value={keyword} maxLength={100} onChange={(e) => setKeyword(e.target.value)} />
            </FormField>
          )}
          {when === "etapa_alterada" && (
            <FormField label="Se for para a etapa" optional>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Qualquer etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={noAssignee} onCheckedChange={(v) => setNoAssignee(Boolean(v))} /> Só se a conversa estiver sem responsável
          </label>
          <FormField label="Esperar antes de agir (minutos)" optional>
            <Input type="number" inputMode="numeric" min={0} max={43200} value={delay} onChange={(e) => setDelay(e.target.value)} className="w-32" />
          </FormField>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Então</legend>
            {actions.map((a, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <Select value={a.type} onValueChange={(t) => patch(i, BLANK[t as AutomationAction["type"]])}>
                    <SelectTrigger className="w-full" aria-label={`Ação ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACTION_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {actions.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover ação ${i + 1}`} onClick={() => setActions((list) => list.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {a.type === "enviar_texto" && <Textarea rows={3} aria-label="Mensagem" placeholder="Olá {nome}, já vamos te atender…" value={a.body} maxLength={4096} onChange={(e) => patch(i, { ...a, body: e.target.value })} />}
                {a.type === "notificar" && <Input aria-label="Texto do aviso" value={a.title} maxLength={200} onChange={(e) => patch(i, { ...a, title: e.target.value })} />}
                {a.type === "criar_tarefa" && (
                  <div className="flex items-center gap-2">
                    <Input aria-label="Título da tarefa" placeholder="Título da tarefa…" value={a.title} maxLength={200} onChange={(e) => patch(i, { ...a, title: e.target.value })} />
                    <Input aria-label="Prazo em horas" type="number" inputMode="numeric" min={0} max={720} value={a.dueHours} onChange={(e) => patch(i, { ...a, dueHours: Number(e.target.value) || 0 })} className="w-20" />
                    <span className="text-xs whitespace-nowrap text-muted-foreground">horas</span>
                  </div>
                )}
                {a.type === "atribuir" && (
                  <Select value={a.userId} onValueChange={(userId) => patch(i, { ...a, userId })}>
                    <SelectTrigger className="w-full" aria-label="Responsável">
                      <SelectValue placeholder="Escolha o responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      {owners.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.full_name || o.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {a.type === "etiquetar" && (
                  <Select value={a.tagId} onValueChange={(tagId) => patch(i, { ...a, tagId })}>
                    <SelectTrigger className="w-full" aria-label="Etiqueta">
                      <SelectValue placeholder="Escolha a etiqueta" />
                    </SelectTrigger>
                    <SelectContent>
                      {tags.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
            {actions.length < 5 && (
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setActions((list) => [...list, BLANK.notificar])}>
                <Plus aria-hidden="true" /> Adicionar ação
              </Button>
            )}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Salvar automação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
