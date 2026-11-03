"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert } from "@/components/app/form-field";
import { cancelHistoryImport, continueHistoryImport, getHistoryState, getQrState, prepareHistorySync, startHistoryImport, type ImportJob, type QrState } from "../qr-actions";

const POLL_QR_MS = 4000;
const POLL_WAIT_MS = 10_000;
const n = (v: number) => v.toLocaleString("pt-BR");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

function Summary({ job }: { job: ImportJob }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {[
        ["Conversas", job.contacts_done],
        ["Grupos", job.groups_done],
        ["Mensagens", job.messages_done],
      ].map(([label, value]) => (
        <div key={label as string} className="rounded-lg bg-muted/50 px-1 py-2">
          <dd className="text-lg font-semibold tabular">{n(value as number)}</dd>
          <dt className="text-xs text-muted-foreground">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Traz as conversas e os grupos do aparelho. Serve logo depois do QR Code e a qualquer momento depois. */
export function HistoryPanel({ numberId, onDone }: { numberId: string; onDone: () => void }) {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState(true);
  const [groups, setGroups] = useState(true);
  const [qr, setQr] = useState<QrState | null>(null);
  const [pending, startTransition] = useTransition();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void getHistoryState({ id: numberId }).then((res) => {
      if (!alive.current) return;
      if (!res?.ok) return setError(res?.message ?? "Não foi possível falar com o servidor do WhatsApp.");
      setReady(res.data.ready);
      setJob(res.data.job);
    });
    return () => {
      alive.current = false;
    };
  }, [numberId]);

  const active = job?.status === "importando" || job?.status === "aguardando";
  const jobId = active ? job!.id : null;

  // Cada chamada trabalha um pouco e devolve o andamento. Fechar a tela não interrompe: a rodada automática continua.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await continueHistoryImport({ id: numberId, jobId }).catch(() => null);
      if (stopped) return;
      if (res?.ok) {
        setJob(res.data);
        router.refresh();
        if (res.data.status !== "importando" && res.data.status !== "aguardando") return;
        timer = setTimeout(tick, res.data.status === "aguardando" ? POLL_WAIT_MS : 300);
      } else {
        timer = setTimeout(tick, POLL_WAIT_MS);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, numberId, router]);

  // Enquanto o QR Code novo está na tela.
  const scanning = qr !== null;
  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getQrState({ id: numberId }).catch(() => null);
      if (stopped) return;
      if (res?.ok) {
        setQr(res.data);
        if (res.data.state === "connected") {
          setQr(null);
          setReady(true);
          toast.success("WhatsApp conectado. Já pode compilar.");
          return;
        }
        if (res.data.state === "failed") return;
      }
      timer = setTimeout(tick, POLL_QR_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [scanning, numberId]);

  function rescan() {
    setError(null);
    startTransition(async () => {
      const res = await prepareHistorySync({ id: numberId });
      if (!res.ok) return setError(res.message ?? "Não foi possível preparar o QR Code.");
      setQr({ state: "starting" });
    });
  }

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await startHistoryImport({ id: numberId, contacts, groups });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message ?? "Não foi possível começar a compilação.");
      setJob(res.data);
    });
  }

  function cancel() {
    if (!job) return;
    startTransition(async () => {
      const res = await cancelHistoryImport({ jobId: job.id });
      if (!res.ok) return setError(res.message ?? "Não foi possível interromper.");
      toast.success(res.message);
      const state = await getHistoryState({ id: numberId });
      if (state?.ok) setJob(state.data.job);
      router.refresh();
    });
  }

  if (error && ready === null) return <FormAlert>{error}</FormAlert>;
  if (ready === null)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Conferindo a conexão…
      </p>
    );

  if (scanning) {
    return (
      <div className="grid justify-items-center gap-3" aria-live="polite">
        <FormAlert>{error}</FormAlert>
        {qr?.state === "qr" ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora pelo servidor de conexão
          <img src={qr.image} alt="QR Code para conectar o WhatsApp" width={264} height={264} className="size-60 rounded-lg border bg-white p-2 sm:size-66" />
        ) : qr?.state === "failed" ? (
          <p className="text-center text-sm text-muted-foreground">O QR Code expirou sem ser lido.</p>
        ) : qr?.state === "unreachable" ? (
          <p className="text-center text-sm text-danger">Não foi possível falar com o servidor. Tentando de novo…</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Gerando o QR Code…
          </p>
        )}
        <p className="max-w-prose text-center text-sm text-muted-foreground">No celular, abra o WhatsApp, toque em Aparelhos conectados e depois em Conectar um aparelho.</p>
        {qr?.state === "failed" && (
          <Button variant="outline" disabled={pending} onClick={rescan}>
            Gerar outro QR Code
          </Button>
        )}
      </div>
    );
  }

  if (!ready && !active) {
    return (
      <div className="grid gap-3">
        <FormAlert>{error}</FormAlert>
        <p className="flex gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>Este número foi conectado antes de o histórico existir aqui. O WhatsApp só envia as conversas antigas no momento do QR Code, então é preciso ler o código de novo. Por alguns instantes, o número fica sem receber mensagens no sistema.</span>
        </p>
        <Button className="justify-self-start" disabled={pending} onClick={rescan}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Ler o QR Code de novo
        </Button>
      </div>
    );
  }

  if (active && job) {
    return (
      <div className="grid gap-3" aria-live="polite">
        <FormAlert>{error}</FormAlert>
        <p className="flex items-center gap-2 text-sm font-medium">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {job.status === "aguardando" ? "Esperando o aparelho enviar o resto do histórico…" : "Compilando as conversas…"}
        </p>
        <Summary job={job} />
        <p className="text-sm text-muted-foreground">{job.last_error ?? "Pode fechar esta tela: a compilação continua sozinha e avisa quando terminar. Abrir conversas antigas não marca nada como lido no celular de ninguém."}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={cancel}>
            Interromper
          </Button>
          <Button variant="outline" onClick={onDone}>
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  const finished = job?.status === "concluida";
  return (
    <div className="grid gap-3">
      <FormAlert>{error}</FormAlert>
      {finished && job && (
        <div className="grid gap-2" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Última compilação concluída
          </p>
          <Summary job={job} />
          {job.skipped > 0 && <p className="text-sm text-muted-foreground">{plural(job.skipped, "conversa ficou", "conversas ficaram")} de fora porque o WhatsApp não informou o telefone.</p>}
          {job.contacts_done + job.groups_done === 0 && <p className="text-sm text-muted-foreground">O aparelho não enviou conversas. Confira se ele estava com internet logo depois do QR Code.</p>}
        </div>
      )}
      {job?.status === "erro" && job.last_error && <FormAlert>{job.last_error}</FormAlert>}
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">O que trazer</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
          <Checkbox checked={contacts} onCheckedChange={(v) => setContacts(v === true)} />
          Conversas individuais
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
          <Checkbox checked={groups} onCheckedChange={(v) => setGroups(v === true)} />
          Grupos
        </label>
      </fieldset>
      <p className="text-sm text-muted-foreground">Vêm até 500 mensagens recentes de cada conversa, e o WhatsApp libera cerca de 1 ano de histórico. Fotos, vídeos e áudios antigos aparecem como aviso, sem o arquivo. Quem tem acesso ao Atendimento passa a ver essas conversas, então desmarque o que for pessoal.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Agora não
        </Button>
        <Button disabled={pending || (!contacts && !groups)} onClick={start}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />} {finished ? "Compilar de novo" : "Compilar conversas"}
        </Button>
      </div>
    </div>
  );
}

export function HistoryDialog({ numberId }: { numberId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) router.refresh();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History aria-hidden="true" /> Compilar conversas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compilar conversas</DialogTitle>
          <DialogDescription>Traz as conversas e os grupos que já estão neste WhatsApp, para gerir aqui e transformar em lead.</DialogDescription>
        </DialogHeader>
        {open && <HistoryPanel numberId={numberId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
