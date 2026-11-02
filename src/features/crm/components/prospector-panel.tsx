"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Laptop, ListChecks, LoaderCircle, Power, RotateCcw, Search as SearchIcon, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UFS } from "@/domain/crm/import";
import { prepareProspectorRows, prospectorFileName, prospectorSegment } from "@/domain/crm/prospector";
import { cn } from "cn";
import { importLeads } from "../actions";
import type { ProspectorImports } from "../queries";

const BRIDGE = "http://127.0.0.1:8091";
const PANEL = "http://127.0.0.1:8090";
const FORM_KEY = "hub.prospector.location";
const CHUNK = 1000;
const STAGES = [
  { key: "docker", label: "Docker" },
  { key: "coletor", label: "Coletor" },
  { key: "painel", label: "Painel" },
] as const;
const SIZES = [
  { value: "rapida", label: "Rápida, até 10 minutos" },
  { value: "padrao", label: "Padrão, até 15 minutos" },
  { value: "completa", label: "Completa, até 20 minutos" },
  { value: "cidade", label: "Cidade inteira, a mais demorada" },
];

type Status = {
  state: "parado" | "iniciando" | "parando" | "pronto" | "erro";
  stage: (typeof STAGES)[number]["key"] | null;
  panel: boolean;
  motor: boolean;
  error: string | null;
};
type Search = {
  id: string;
  estado: "na_fila" | "rodando" | "concluida" | "erro" | "cancelada";
  etapa: string;
  total: number;
  parcial?: number;
  posicao_fila?: number;
  com_whatsapp?: number;
  com_email?: number;
  sem_site?: number;
  avisos?: string[];
  progresso?: { atual: number; total: number; fase: string } | null;
  parametros: { nichos: string[]; cidade: string; uf: string; bairro?: string };
};
type City = { n: string; uf: string };
type Connection = "checking" | "online" | "offline";

// Parar vale até recarregar a página, inclusive ao voltar da importação.
let stoppedByUser = false;

async function request(path: string, body?: object) {
  let response: Response;
  try {
    response = await fetch(BRIDGE + path, {
      method: body ? "POST" : "GET",
      headers: { "X-Hub-Bridge": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === "/stop" ? 200_000 : 20_000),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new TypeError("offline");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "O prospectador não respondeu. Tente de novo.");
  }
  return response;
}

function readLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? "{}");
    return { uf: String(saved.uf ?? ""), cidade: String(saved.cidade ?? "") };
  } catch {
    return { uf: "", cidade: "" };
  }
}

function saveLocation(uf: string, cidade: string) {
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify({ uf, cidade }));
  } catch {
    // Só uma conveniência: o formulário funciona sem armazenamento.
  }
}

function plainText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
}

export function ProspectorPanel({
  onFiles,
  pipelines,
  added,
  segments,
}: {
  onFiles: (files: File[], segment?: string) => Promise<void>;
  pipelines: { id: string; name: string }[];
  added: ProspectorImports;
  segments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [connection, setConnection] = useState<Connection>("checking");
  const [status, setStatus] = useState<Status | null>(null);
  const [searches, setSearches] = useState<Search[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ field: "uf" | "cidade"; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPhone, setIsPhone] = useState(false);
  const [form, setForm] = useState({ nichos: "", cidade: "", uf: "", bairro: "", tamanho: "padrao" });
  const autoStarted = useRef(false);
  const statusRef = useRef<Status | null>(null);
  const nichoRef = useRef<HTMLInputElement>(null);
  const ufRef = useRef<HTMLButtonElement>(null);
  const cidadeRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next: Status = await (await request("/status")).json();
      statusRef.current = next;
      setStatus(next);
      setConnection("online");
      if (next.panel) setSearches(await (await request("/buscas")).json());
      if ((next.state === "parado" || next.state === "erro") && !autoStarted.current && !stoppedByUser) {
        autoStarted.current = true;
        await request("/start", {});
        const started: Status = await (await request("/status")).json();
        statusRef.current = started;
        setStatus(started);
      }
    } catch (e) {
      if (e instanceof TypeError) {
        statusRef.current = null;
        setStatus(null);
        setConnection("offline");
      } else {
        setError((e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden) await refresh();
      if (cancelled) return;
      const state = statusRef.current?.state;
      timer = setTimeout(() => void poll(), state === "iniciando" || state === "parando" ? 2000 : 5000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    // Lido só no navegador para não divergir do HTML do servidor.
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsPhone(window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches);
    setForm((current) => ({ ...current, ...readLocation() }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const panelUp = Boolean(status?.panel);
  useEffect(() => {
    if (!panelUp || cities.length) return;
    request("/municipios")
      .then((response) => response.json())
      .then(setCities)
      .catch(() => undefined); // A cidade continua podendo ser digitada livremente.
  }, [panelUp, cities.length]);

  const citiesOfUf = useMemo(() => cities.filter((city) => city.uf === form.uf), [cities, form.uf]);
  const active = searches.some((search) => search.estado === "na_fila" || search.estado === "rodando");
  const state = status?.state;
  const ready = state === "pronto";

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof TypeError ? "O computador parou de responder. Confira se o conector está ligado." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function start() {
    stoppedByUser = false;
    void run("start", async () => {
      await request("/start", {});
    });
  }

  function stop() {
    void run("stop", async () => {
      stoppedByUser = true;
      await request("/stop", {});
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!form.uf) {
      setFormError({ field: "uf", message: "Escolha o estado da busca." });
      ufRef.current?.focus();
      return;
    }
    // Sem a lista carregada, o próprio prospectador valida a cidade ao buscar.
    if (citiesOfUf.length && !citiesOfUf.some((city) => plainText(city.n) === plainText(form.cidade))) {
      setFormError({ field: "cidade", message: `Não encontramos “${form.cidade.trim()}” em ${form.uf}. Confira a cidade ou o estado.` });
      cidadeRef.current?.focus();
      return;
    }
    void run("search", async () => {
      await request("/buscas", form);
      saveLocation(form.uf, form.cidade);
      setForm((current) => ({ ...current, nichos: "", bairro: "" }));
      nichoRef.current?.focus();
    });
  }

  function importSearch(search: Search) {
    void run(`import:${search.id}`, async () => {
      const csv = await (await request(`/buscas/${search.id}/csv`)).blob();
      await onFiles([new File([csv], prospectorFileName(search), { type: "text/csv" })], prospectorSegment(search.parametros.nichos));
    });
  }

  function addToCrm(search: Search) {
    void run(`add:${search.id}`, async () => {
      if (!pipelineId) throw new Error("Crie um funil antes de adicionar os leads.");
      const csv = await (await request(`/buscas/${search.id}/csv`)).text();
      const { rows, invalid, duplicates } = prepareProspectorRows(csv);
      if (!rows.length) throw new Error("Esta busca não tem empresas válidas para adicionar.");
      let inserted = 0;
      let skipped = duplicates;
      let failed = invalid;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await importLeads({
          fileName: prospectorFileName(search),
          pipelineId,
          mode: "skip",
          segmentName: prospectorSegment(search.parametros.nichos),
          rows: rows.slice(i, i + CHUNK),
        });
        if (!res.ok) throw new Error(inserted ? `${plural(inserted, "lead adicionado", "leads adicionados")} antes do erro: ${res.message}` : res.message);
        inserted += res.data.inserted;
        skipped += res.data.skipped;
        failed += res.data.invalid;
      }
      toast.success(
        [plural(inserted, "lead adicionado ao CRM", "leads adicionados ao CRM"), skipped ? plural(skipped, "já estava", "já estavam") : "", failed ? plural(failed, "com dados inválidos", "com dados inválidos") : ""].filter(Boolean).join(", ") + ".",
      );
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5">
      <section aria-labelledby="prospectador-status" className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-72 gap-3" role="status">
            <StatusIcon connection={connection} state={state} />
            <div className="grid min-w-0 gap-0.5">
              <h2 id="prospectador-status" className="font-semibold text-pretty">
                {headline(connection, state, isPhone)}
              </h2>
              <p className="text-sm text-muted-foreground text-pretty">{detail(connection, state, isPhone, active)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection === "offline" && !isPhone && (
              <>
                <Button asChild>
                  <a href="hubsystem-prospectador://start">
                    <Power aria-hidden="true" /> Ligar prospectador
                  </a>
                </Button>
                <Button variant="outline" onClick={() => void run("retry", refresh)} disabled={Boolean(busy)}>
                  Verificar de novo
                </Button>
              </>
            )}
            {connection === "offline" && isPhone && (
              <Button variant="outline" asChild>
                <Link href="/crm/leads">Ver leads</Link>
              </Button>
            )}
            {(state === "parado" || state === "erro") && (
              <Button onClick={start} disabled={Boolean(busy)}>
                <Power aria-hidden="true" /> {state === "erro" ? "Tentar de novo" : "Ligar coletor"}
              </Button>
            )}
            {ready && (
              <Button variant="outline" onClick={stop} disabled={Boolean(busy) || active} title={active ? "Disponível quando as buscas terminarem" : undefined}>
                <Power aria-hidden="true" /> Parar coletor
              </Button>
            )}
            {status?.panel && (
              <Button variant="ghost" asChild>
                <a href={PANEL} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> Painel completo
                </a>
              </Button>
            )}
          </div>
        </div>

        {state === "iniciando" && <StartupSteps stage={status?.stage ?? "docker"} />}

        {status?.error && (
          <p role="alert" className="flex gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> <span className="min-w-0 break-words">{status.error}</span>
          </p>
        )}
        {error && (
          <p role="alert" className="flex gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> <span className="min-w-0 break-words">{error}</span>
          </p>
        )}
      </section>

      {connection === "online" && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <form onSubmit={submit} aria-labelledby="prospectador-nova" className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5 lg:sticky lg:top-4">
            <h2 id="prospectador-nova" className="font-semibold">
              Nova busca
            </h2>
            <div className="grid gap-1.5">
              <Label htmlFor="pros-nichos">O que procurar</Label>
              <Input
                ref={nichoRef}
                id="pros-nichos"
                name="nichos"
                value={form.nichos}
                onChange={(e) => setForm({ ...form, nichos: e.target.value })}
                placeholder="clínicas odontológicas, pet shops…"
                autoComplete="off"
                aria-describedby="pros-nichos-ajuda"
                required
                maxLength={300}
              />
              <p id="pros-nichos-ajuda" className="text-xs text-muted-foreground">
                Separe por vírgula para buscar mais de um tipo, até 10.
              </p>
            </div>
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pros-uf">Estado</Label>
                <Select
                  value={form.uf}
                  onValueChange={(uf) => {
                    setFormError(null);
                    setForm({ ...form, uf });
                  }}
                >
                  <SelectTrigger ref={ufRef} id="pros-uf" aria-invalid={formError?.field === "uf"} aria-describedby={formError?.field === "uf" ? "pros-form-erro" : undefined} className="w-full">
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    {UFS.map((uf) => (
                      <SelectItem key={uf} value={uf}>
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pros-cidade">Cidade</Label>
                <Input
                  ref={cidadeRef}
                  id="pros-cidade"
                  name="cidade"
                  value={form.cidade}
                  onChange={(e) => {
                    setFormError(null);
                    setForm({ ...form, cidade: e.target.value });
                  }}
                  aria-invalid={formError?.field === "cidade"}
                  aria-describedby={formError?.field === "cidade" ? "pros-form-erro" : undefined}
                  list="pros-cidades"
                  autoComplete="off"
                  required
                  maxLength={120}
                />
                <datalist id="pros-cidades">
                  {citiesOfUf.map((city) => (
                    <option key={city.n} value={city.n} />
                  ))}
                </datalist>
              </div>
            </div>
            {formError && (
              <p id="pros-form-erro" role="alert" className="-mt-2 text-sm text-destructive">
                {formError.message}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="pros-bairro">Bairro (opcional)</Label>
              <Input id="pros-bairro" name="bairro" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} autoComplete="off" maxLength={120} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pros-tamanho">Abrangência</Label>
              <Select value={form.tamanho} onValueChange={(tamanho) => setForm({ ...form, tamanho })}>
                <SelectTrigger id="pros-tamanho" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!ready || Boolean(busy)}>
              {busy === "search" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
              {ready ? "Iniciar busca" : state === "iniciando" ? "Aguardando o coletor…" : "Ligue o coletor para buscar"}
            </Button>
          </form>

          <section aria-labelledby="prospectador-buscas" className="grid min-w-0 gap-3 rounded-xl border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="prospectador-buscas" className="font-semibold">
                Buscas neste computador
              </h2>
              {pipelines.length > 1 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="pros-funil" className="shrink-0 text-sm font-normal text-muted-foreground">
                    Adicionar no funil
                  </Label>
                  <Select value={pipelineId} onValueChange={setPipelineId}>
                    <SelectTrigger id="pros-funil" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map((pipeline) => (
                        <SelectItem key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {!status?.panel ? (
              <p className="py-6 text-sm text-muted-foreground">{state === "iniciando" ? "Suas buscas aparecem aqui assim que o painel ligar." : "Ligue o coletor para ver suas buscas."}</p>
            ) : !searches.length ? (
              <p className="py-6 text-sm text-muted-foreground">Nenhuma busca ainda. Preencha o formulário para encontrar as primeiras empresas.</p>
            ) : (
              <ul className="grid divide-y">
                {searches.map((search) => (
                  <SearchRow
                    key={search.id}
                    search={search}
                    busy={busy}
                    ready={ready}
                    added={added[search.id]}
                    segmentId={segments.find((segment) => plainText(segment.name) === plainText(prospectorSegment(search.parametros.nichos)))?.id}
                    onAdd={() => addToCrm(search)}
                    onImport={() => importSearch(search)}
                    onCancel={() => void run(`cancel:${search.id}`, async () => void (await request(`/buscas/${search.id}/cancelar`, {})))}
                    onRepeat={() => void run(`repeat:${search.id}`, async () => void (await request(`/buscas/${search.id}/repetir`, {})))}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function headline(connection: Connection, state: Status["state"] | undefined, isPhone: boolean) {
  if (connection === "checking") return "Procurando o prospectador neste computador…";
  if (connection === "offline") return isPhone ? "As buscas rodam no seu computador" : "O prospectador está desligado neste computador";
  if (state === "iniciando") return "Ligando o prospectador…";
  if (state === "parando") return "Parando o coletor…";
  if (state === "pronto") return "Prospectador pronto para buscar";
  if (state === "erro") return "O coletor não ligou";
  return "Coletor parado";
}

function detail(connection: Connection, state: Status["state"] | undefined, isPhone: boolean, active: boolean) {
  if (connection === "checking") return "Isso leva só alguns segundos.";
  if (connection === "offline") {
    return isPhone
      ? "Abra esta página no computador para buscar empresas. Os leads já importados ficam disponíveis aqui no celular."
      : "Clique em Ligar prospectador e permita abrir o aplicativo. Se o navegador pedir acesso à rede local, permita também.";
  }
  if (state === "iniciando") return "O Docker pode levar até 3 minutos para abrir. Pode continuar preenchendo a busca.";
  if (state === "parando") return "Seus resultados continuam salvos no computador.";
  if (state === "pronto") return active ? "As buscas continuam mesmo se você fechar esta aba. Para parar o coletor, aguarde o fim delas ou cancele." : "O Docker e o coletor estão funcionando no seu computador.";
  if (state === "erro") return "Confira a mensagem abaixo e tente de novo.";
  return "Seus resultados continuam salvos. Ligue o coletor para fazer novas buscas.";
}

function StatusIcon({ connection, state }: { connection: Connection; state?: Status["state"] }) {
  const className = "mt-0.5 size-5 shrink-0";
  if (connection === "checking" || state === "iniciando" || state === "parando") {
    return <LoaderCircle className={cn(className, "animate-spin text-primary motion-reduce:animate-none")} aria-hidden="true" />;
  }
  if (connection === "offline") return <Laptop className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
  if (state === "pronto") return <CheckCircle2 className={cn(className, "text-success")} aria-hidden="true" />;
  if (state === "erro") return <AlertTriangle className={cn(className, "text-destructive")} aria-hidden="true" />;
  return <Power className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
}

function StartupSteps({ stage }: { stage: NonNullable<Status["stage"]> }) {
  const current = STAGES.findIndex((item) => item.key === stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Etapas para ligar o prospectador">
      {STAGES.map((item, index) => (
        <li key={item.key} aria-current={index === current ? "step" : undefined} className={cn("flex items-center gap-2", index > current ? "text-muted-foreground" : "font-medium")}>
          {index < current ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : index === current ? (
            <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <span className="size-4 rounded-full border" aria-hidden="true" />
          )}
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function SearchRow({
  search,
  busy,
  ready,
  added,
  segmentId,
  onAdd,
  onImport,
  onCancel,
  onRepeat,
}: {
  search: Search;
  busy: string | null;
  ready: boolean;
  added?: ProspectorImports[string];
  segmentId?: string;
  onAdd: () => void;
  onImport: () => void;
  onCancel: () => void;
  onRepeat: () => void;
}) {
  const { parametros: params, estado, progresso } = search;
  const running = estado === "rodando" || estado === "na_fila";
  const percent = progresso?.total ? Math.round((progresso.atual / progresso.total) * 100) : null;
  const place = [params.bairro, `${params.cidade}/${params.uf}`].filter(Boolean).join(", ");
  const facts = [
    { label: plural(search.sem_site ?? 0, "sem site", "sem site"), strong: true },
    { label: plural(search.com_whatsapp ?? 0, "com WhatsApp", "com WhatsApp") },
    { label: plural(search.com_email ?? 0, "com e-mail", "com e-mail") },
  ];

  return (
    <li className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="grid min-w-0 gap-1">
        <p className="font-medium text-pretty break-words">{params.nichos.join(", ")}</p>
        <p className="text-sm text-muted-foreground">{place}</p>
        {estado === "concluida" && (
          <>
            <p className="text-sm tabular">{plural(search.total, "empresa encontrada", "empresas encontradas")}</p>
            {search.total > 0 && (
              <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
                {facts.map((fact) => (
                  <li key={fact.label} className={cn(fact.strong && "font-medium text-foreground")}>
                    {fact.label}
                  </li>
                ))}
              </ul>
            )}
            {added && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                {added.inserted ? plural(added.inserted, "lead no CRM", "leads no CRM") : "Empresas já estavam no CRM"}
                {added.inserted && added.skipped ? `, ${plural(added.skipped, "já estava", "já estavam")}` : ""}
              </p>
            )}
          </>
        )}
        {estado === "na_fila" && <p className="text-sm text-muted-foreground tabular">{search.posicao_fila ? `Na fila, posição ${search.posicao_fila}` : "Na fila"}</p>}
        {estado === "rodando" && (
          <div className="mt-1 grid gap-1.5">
            <Progress value={percent ?? undefined} aria-label={`Andamento da busca ${params.nichos.join(", ")}`} className={cn(percent === null && "animate-pulse motion-reduce:animate-none")} />
            <p className="text-xs text-muted-foreground tabular break-words">
              {search.etapa}
              {search.parcial ? `. ${plural(search.parcial, "empresa até agora", "empresas até agora")}` : ""}
            </p>
          </div>
        )}
        {estado === "erro" && <p className="text-sm text-destructive break-words">{search.etapa}</p>}
        {estado === "cancelada" && <p className="text-sm text-muted-foreground">Busca cancelada</p>}
        {Boolean(search.avisos?.length) && <p className="text-xs text-warning break-words">{search.avisos!.join(" ")}</p>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {estado === "concluida" && search.total > 0 && !added && (
          <>
            <Button size="sm" onClick={onAdd} disabled={Boolean(busy)}>
              {busy === `add:${search.id}` ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
              {busy === `add:${search.id}` ? "Adicionando…" : "Adicionar ao CRM"}
            </Button>
            <Button size="sm" variant="outline" onClick={onImport} disabled={Boolean(busy)}>
              {busy === `import:${search.id}` ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ListChecks aria-hidden="true" />}
              Revisar antes
            </Button>
          </>
        )}
        {estado === "concluida" && added && (
          <Button size="sm" variant="outline" asChild>
            <Link href={segmentId ? `/crm/leads?segmento=${segmentId}` : "/crm/leads"}>Ver leads</Link>
          </Button>
        )}
        {running && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={Boolean(busy)}>
            <X aria-hidden="true" /> Cancelar busca
          </Button>
        )}
        {!running && (estado !== "concluida" || !search.total) && (
          <Button size="sm" variant="outline" onClick={onRepeat} disabled={Boolean(busy) || !ready}>
            <RotateCcw aria-hidden="true" /> Repetir busca
          </Button>
        )}
      </div>
    </li>
  );
}
