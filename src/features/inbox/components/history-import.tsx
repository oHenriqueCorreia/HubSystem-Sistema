"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, History, LoaderCircle, Smartphone, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormAlert, FormField } from "@/components/app/form-field";
import { cancelHistoryImport, continueHistoryImport, enableGroupsNow, getHistoryState, getQrState, prepareHistorySync, requestPairingCode, startHistoryImport, type ImportJob, type QrState } from "../qr-actions";

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

/**
 * Pareamento do aparelho. Quem usa o sistema no próprio celular não consegue escanear a própria tela:
 * nesse caso, o código de 8 letras faz o mesmo papel do QR Code.
 */
export function PairingBlock({ numberId, state, phone = "", onRetry, retrying }: { numberId: string; state: QrState; phone?: string; onRetry?: () => void; retrying?: boolean }) {
  const [mode, setMode] = useState<"qr" | "codigo">("qr");
  const [number, setNumber] = useState(phone);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask() {
    setError(null);
    setCode(null);
    startTransition(async () => {
      const res = await requestPairingCode({ id: numberId, phone: number });
      if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message ?? "Não foi possível gerar o código.");
      setCode(res.data.code);
    });
  }

  if (mode === "codigo") {
    return (
      <div className="grid gap-3" aria-live="polite">
        <FormAlert>{error}</FormAlert>
        {code ? (
          <>
            <p className="text-center text-3xl font-semibold tracking-widest tabular" aria-label={`Código ${code}`}>
              {code}
            </p>
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast.success("Código copiado."))}>
              <Copy aria-hidden="true" /> Copiar código
            </Button>
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
              <li>No WhatsApp, abra Aparelhos conectados.</li>
              <li>Toque em Conectar um aparelho.</li>
              <li>Toque em Conectar com número de telefone.</li>
              <li>Digite o código acima.</li>
            </ol>
          </>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <FormField label="Número deste WhatsApp" hint="Com DDD. É o número que vai ser conectado.">
              <Input type="tel" inputMode="tel" name="telefone" autoComplete="off" placeholder="(48) 99999-0000…" value={number} onChange={(e) => setNumber(e.target.value)} />
            </FormField>
            <Button type="submit" disabled={pending || number.replace(/\D/g, "").length < 10}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Gerar código
            </Button>
          </form>
        )}
        <Button variant="ghost" onClick={() => setMode("qr")}>
          Usar o QR Code
        </Button>
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-3" aria-live="polite">
      {state.state === "qr" ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora pelo servidor de conexão
        <img src={state.image} alt="QR Code para conectar o WhatsApp" width={264} height={264} className="size-60 rounded-lg border bg-white p-2 sm:size-66" />
      ) : state.state === "failed" ? (
        <p className="text-center text-sm text-muted-foreground">O QR Code expirou sem ser lido.</p>
      ) : state.state === "unreachable" ? (
        <p className="text-center text-sm text-danger">Não foi possível falar com o servidor. Tentando de novo…</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Gerando o QR Code…
        </p>
      )}
      {state.state === "qr" && <p className="max-w-prose text-center text-sm text-muted-foreground">No celular do número, abra o WhatsApp, toque em Aparelhos conectados e depois em Conectar um aparelho. O código muda sozinho.</p>}
      {state.state === "failed" && onRetry && (
        <Button variant="outline" disabled={retrying} onClick={onRetry}>
          {retrying && <LoaderCircle className="animate-spin" aria-hidden="true" />} Gerar outro QR Code
        </Button>
      )}
      {state.state !== "failed" && (
        <Button variant="outline" className="w-full" onClick={() => setMode("codigo")}>
          <Smartphone aria-hidden="true" /> Está usando o celular do número? Conectar com código
        </Button>
      )}
    </div>
  );
}

/** Traz as conversas e os grupos do aparelho. Serve logo depois do QR Code e a qualquer momento depois. */
export function HistoryPanel({ numberId, onDone }: { numberId: string; onDone: () => void }) {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [groupsOn, setGroupsOn] = useState(false);
  const [phone, setPhone] = useState("");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState(true);
  const [groups, setGroups] = useState(true);
  const [qr, setQr] = useState<QrState | null>(null);
  const [groupsResult, setGroupsResult] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void getHistoryState({ id: numberId }).then((res) => {
      if (!alive.current) return;
      if (!res?.ok) return setError(res?.message ?? "Não foi possível falar com o servidor do WhatsApp.");
      setReady(res.data.ready);
      setGroupsOn(res.data.groupsOn);
      setPhone(res.data.phone);
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

  // Enquanto o pareamento novo está na tela.
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
          setGroupsOn(true);
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

  function groupsOnly() {
    setError(null);
    startTransition(async () => {
      const res = await enableGroupsNow({ id: numberId });
      if (!res.ok) return setError(res.message ?? "Não foi possível ativar os grupos.");
      setGroupsOn(true);
      setGroupsResult(res.data.groups);
      toast.success(res.message);
      router.refresh();
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
      <div className="grid gap-3">
        <FormAlert>{error}</FormAlert>
        <PairingBlock numberId={numberId} state={qr} phone={phone} onRetry={rescan} retrying={pending} />
      </div>
    );
  }

  if (!ready && !active) {
    return (
      <div className="grid gap-4">
        <FormAlert>{error}</FormAlert>
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <History className="size-4 shrink-0" aria-hidden="true" /> Conversas antigas e histórico dos grupos
          </p>
          <p className="text-sm text-muted-foreground">O WhatsApp só envia o histórico no momento da conexão, então é preciso conectar este número de novo. As conversas que já estão aqui continuam, e o número fica alguns instantes sem receber no sistema.</p>
          <Button disabled={pending} onClick={rescan}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Conectar de novo e trazer tudo
          </Button>
        </div>
        {groupsOn ? (
          <p className="flex items-center gap-2 text-sm text-success" role="status">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            {groupsResult === null ? "Os grupos já estão ativos neste número." : `${plural(groupsResult, "grupo está", "grupos estão")} no Atendimento. As mensagens novas chegam a partir de agora.`}
          </p>
        ) : (
          <div className="grid gap-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Users className="size-4 shrink-0" aria-hidden="true" /> Só os grupos, sem conectar de novo
            </p>
            <p className="text-sm text-muted-foreground">Os grupos aparecem agora e recebem as mensagens novas. As mensagens antigas deles vêm só conectando de novo.</p>
            <Button variant="outline" disabled={pending} onClick={groupsOnly}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} Ativar os grupos agora
            </Button>
          </div>
        )}
        <p className="flex gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Quem tem acesso ao Atendimento passa a ver o que for trazido.
        </p>
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
        <p className="text-sm text-muted-foreground">{job.last_error ?? "Pode fechar esta tela: a compilação continua sozinha e avisa quando terminar. O aparelho envia o histórico aos poucos, e isso pode levar alguns minutos. Mantenha o celular com internet."}</p>
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
          {job.skipped > 0 && <p className="text-sm text-muted-foreground">{plural(job.skipped, "conversa ficou", "conversas ficaram")} de fora: o WhatsApp não informou o telefone ou não entregou as mensagens. Compilar de novo tenta outra vez.</p>}
          {job.contacts_done + job.groups_done === 0 && <p className="text-sm text-muted-foreground">O aparelho não enviou conversas. Confira se ele estava com internet logo depois de conectar.</p>}
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

export function HistoryDialog({ numberId, label = "Compilar conversas", size = "sm" }: { numberId: string; label?: string; size?: "sm" | "default" }) {
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
        <Button variant="outline" size={size}>
          <History aria-hidden="true" /> {label}
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

/** Aviso na lista: as conversas só aparecem depois de compilar, então o caminho precisa estar à vista. */
export function HistoryBanner({ numberId, name }: { numberId: string; name: string }) {
  return (
    <div className="grid justify-items-start gap-2 border-b bg-info-soft px-3 py-2" role="region" aria-label="Trazer conversas antigas">
      <p className="text-sm">
        <strong className="font-semibold">Compile as conversas</strong> de {name} para elas aparecerem aqui, com os nomes dos clientes e os grupos.
      </p>
      <HistoryDialog numberId={numberId} label="Trazer conversas e grupos" />
    </div>
  );
}
