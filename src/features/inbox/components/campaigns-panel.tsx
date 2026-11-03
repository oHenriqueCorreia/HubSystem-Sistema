"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Megaphone, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { EmptyState } from "@/components/app/states";
import { formatDateTime } from "@/domain/shared/dates";
import { createCampaign, previewAudience, setCampaignStatus } from "../ops-actions";

type Campaign = { id: string; name: string; status: string; scheduled_at: string | null; created_at: string; total: number; enviados: number; bloqueados: number; erros: number; pendentes: number };
type Option = { id: string; name: string };
type NumberOption = { id: string; provider: "cloud" | "waha"; label: string };
type TemplateOption = { id: string; name: string; language: string; body: string };

const STATUS_LABEL: Record<string, string> = { rascunho: "Rascunho", enviando: "Enviando", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };
const ALL = "__todos__";

export function CampaignsPanel({ campaigns, numbers, templates, tags, stages, dailyLimit }: { campaigns: Campaign[]; numbers: NumberOption[]; templates: TemplateOption[]; tags: Option[]; stages: Option[]; dailyLimit: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(id: string, action: "iniciar" | "pausar" | "cancelar") {
    startTransition(async () => {
      const res = await setCampaignStatus({ id, action });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <p className="flex max-w-prose gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          Só entram contatos com autorização registrada. Os envios saem um a cada 5 a 7 segundos, de segunda a sábado, das 8h às 20h, até {dailyLimit} por dia. Mesmo assim, campanhas pelo QR Code podem levar a
          bloqueio do número.
        </span>
      </p>
      <div>
        {numbers.length === 0 ? <p className="text-sm text-muted-foreground">Conecte um número em Conversas para criar uma campanha.</p> : <CampaignDialog numbers={numbers} templates={templates} tags={tags} stages={stages} />}
      </div>
      {campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhuma campanha ainda" description="Escolha uma etiqueta ou etapa do funil, escreva a mensagem e revise antes de iniciar." />
      ) : (
        <ul className="grid gap-2">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{c.name}</p>
                <p className="text-xs text-muted-foreground tabular">
                  {c.enviados} de {c.total} enviados, {c.pendentes} na fila, {c.bloqueados} bloqueados, {c.erros} com erro
                  {c.scheduled_at ? `. Começa em ${formatDateTime(c.scheduled_at)}` : ""}
                </p>
              </div>
              <Badge variant={c.status === "enviando" ? "default" : "outline"}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
              {(c.status === "rascunho" || c.status === "pausada") && (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" disabled={pending}>
                      {c.status === "rascunho" ? "Iniciar" : "Continuar"}
                    </Button>
                  }
                  title={`Enviar para ${c.pendentes} contato(s)?`}
                  description="As mensagens começam a sair na próxima rodada, dentro do horário permitido. Dá para pausar a qualquer momento."
                  confirmLabel={c.status === "rascunho" ? "Iniciar campanha" : "Continuar campanha"}
                  onConfirm={async () => change(c.id, "iniciar")}
                />
              )}
              {c.status === "enviando" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => change(c.id, "pausar")}>
                  Pausar
                </Button>
              )}
              {(c.status === "rascunho" || c.status === "pausada" || c.status === "enviando") && (
                <ConfirmDialog
                  tone="danger"
                  trigger={
                    <Button size="sm" variant="ghost" disabled={pending}>
                      Cancelar
                    </Button>
                  }
                  title="Cancelar esta campanha?"
                  description="Quem ainda não recebeu não vai mais receber. Isso não pode ser desfeito."
                  confirmLabel="Cancelar campanha"
                  onConfirm={async () => change(c.id, "cancelar")}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignDialog({ numbers, templates, tags, stages }: { numbers: NumberOption[]; templates: TemplateOption[]; tags: Option[]; stages: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [tagId, setTagId] = useState(ALL);
  const [stageId, setStageId] = useState(ALL);
  const [schedule, setSchedule] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cloud = numbers.find((n) => n.id === numberId)?.provider === "cloud";
  const filter = { tagId: tagId === ALL ? null : tagId, stageId: stageId === ALL ? null : stageId };

  // Mostra quantos contatos entram antes de criar: quem não autorizou nunca aparece aqui.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void previewAudience({ tagId: tagId === ALL ? null : tagId, stageId: stageId === ALL ? null : stageId }).then((res) => {
      if (!stale && res.ok) setCount(res.data.count);
    });
    return () => {
      stale = true;
    };
  }, [open, tagId, stageId]);

  function submit() {
    setError(null);
    const text = cloud ? (templates.find((t) => t.id === templateId)?.body ?? "") : body;
    startTransition(async () => {
      const res = await createCampaign({ ...filter, name, numberId, body: text, templateId: cloud ? templateId || null : null, scheduledAt: schedule ? new Date(schedule).toISOString() : null });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
      toast.success(res.message);
      setOpen(false);
      setName("");
      setBody("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> Nova campanha
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>A campanha fica como rascunho até você clicar em Iniciar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormAlert>{error}</FormAlert>
          <FormField label="Nome" required>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Número">
            <Select value={numberId} onValueChange={setNumberId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} ({n.provider === "waha" ? "QR Code" : "API oficial"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Etiqueta">
              <Select value={tagId} onValueChange={setTagId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Etapa do funil">
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas</SelectItem>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <p className="text-sm tabular" aria-live="polite">
            {count === null ? "Contando contatos…" : `${count} contato(s) com autorização nestes filtros.`}
          </p>
          {cloud ? (
            <FormField label="Modelo aprovado" required hint="{{1}} vira o primeiro nome e {{2}}, a empresa.">
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha o modelo" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : (
            <FormField label="Mensagem" required hint="Use {nome} e {empresa}. O aviso para responder SAIR entra sozinho no fim.">
              <Textarea rows={4} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
            </FormField>
          )}
          <FormField label="Começar em" optional hint="Em branco, começa assim que você iniciar.">
            <Input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Fechar
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length < 2 || !count || (cloud ? !templateId : !body.trim())}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Criar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
