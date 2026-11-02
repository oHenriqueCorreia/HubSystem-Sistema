"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LoaderCircle, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { formatDateTime } from "@/domain/shared/dates";
import { buildUtmUrl, utmQuery, utmSlug, UTM_PRESETS, type UtmParams } from "@/domain/ads/utm";
import { deleteUtmLink, saveUtmLink } from "../actions";
import type { AdClient, UtmLink } from "../queries";

type CampaignOption = { id: string; name: string; clientId: string | null; active: boolean };

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado.`);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

const validUrl = (u: string) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(u.trim());

/** Gerador de links com UTM: modelos da Meta e do Google, campanha sincronizada e cópia rápida. */
export function UtmBuilder({ clients, campaigns, canManage }: { clients: AdClient[]; campaigns: CampaignOption[]; canManage: boolean }) {
  const router = useRouter();
  const [preset, setPreset] = useState("meta");
  const [params, setParams] = useState<UtmParams>(UTM_PRESETS[0].params);
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string>("__sem__");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const options = useMemo(() => campaigns.filter((c) => clientId === "__sem__" || c.clientId === clientId), [campaigns, clientId]);
  const urlOk = validUrl(baseUrl);
  const ready = urlOk && params.source.trim() && params.medium.trim() && params.campaign.trim();
  const fullUrl = ready ? buildUtmUrl(baseUrl, params) : "";
  const query = utmQuery(params);
  const set = (k: keyof UtmParams) => (e: React.ChangeEvent<HTMLInputElement>) => setParams((p) => ({ ...p, [k]: e.target.value }));

  function choosePreset(id: string) {
    setPreset(id);
    setParams(UTM_PRESETS.find((p) => p.id === id)!.params);
  }

  function save() {
    startTransition(async () => {
      const res = await saveUtmLink({
        name,
        clientId: clientId === "__sem__" ? null : clientId,
        baseUrl: baseUrl.trim(),
        source: params.source,
        medium: params.medium,
        campaign: params.campaign,
        content: params.content ?? "",
        term: params.term ?? "",
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ? Object.fromEntries(Object.entries(res.fieldErrors).map(([k, v]) => [k, v[0]])) : {});
        return void toast.error(res.message);
      }
      toast.success(res.message);
      setErrors({});
      setName("");
      router.refresh();
    });
  }

  const presetInfo = UTM_PRESETS.find((p) => p.id === preset)!;

  return (
    <section aria-labelledby="gerador" className="grid gap-5 rounded-xl border bg-surface p-4 sm:p-5">
      <div className="grid gap-1">
        <h2 id="gerador" className="text-base font-semibold">
          Criar link com UTM
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          As UTMs mostram no Google Analytics (e em qualquer ferramenta de análise) de qual plataforma, campanha e anúncio veio cada visita. Use o mesmo padrão em todos os anúncios para comparar os resultados.
        </p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Modelo</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Modelo">
          {UTM_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              onClick={() => choosePreset(p.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm",
                preset === p.id ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{presetInfo.description}</p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="URL de destino" hint="A página para onde o anúncio leva." error={errors.baseUrl ?? (baseUrl && !urlOk ? "Use a URL completa, começando com https://" : undefined)} required className="md:col-span-2">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} type="url" inputMode="url" autoComplete="url" spellCheck={false} placeholder="https://seusite.com.br/oferta…" />
        </FormField>
        <FormField label="Origem (utm_source)" error={errors.source} required>
          <Input value={params.source} onChange={set("source")} spellCheck={false} autoComplete="off" placeholder="facebook, instagram, google…" />
        </FormField>
        <FormField label="Mídia (utm_medium)" error={errors.medium} required>
          <Input value={params.medium} onChange={set("medium")} spellCheck={false} autoComplete="off" placeholder="paid_social, cpc, email…" />
        </FormField>
        <FormField label="Campanha (utm_campaign)" error={errors.campaign} required>
          <Input value={params.campaign} onChange={set("campaign")} spellCheck={false} autoComplete="off" placeholder="black_friday_2026…" />
        </FormField>
        <FormField label="Usar o nome de uma campanha sincronizada" hint="Preenche a campanha no padrão de UTM (sem acentos e espaços)." optional>
          <Select value="" onValueChange={(id) => setParams((p) => ({ ...p, campaign: utmSlug(options.find((c) => c.id === id)?.name ?? "") }))} disabled={!options.length}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={options.length ? "Escolha uma campanha…" : "Nenhuma campanha sincronizada"} />
            </SelectTrigger>
            <SelectContent>
              {options.slice(0, 200).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (pausada)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Conteúdo (utm_content)" hint="Diferencia anúncios ou criativos." error={errors.content} optional>
          <Input value={params.content ?? ""} onChange={set("content")} spellCheck={false} autoComplete="off" placeholder="video_depoimento…" />
        </FormField>
        <FormField label="Termo (utm_term)" hint="Público, conjunto ou palavra-chave." error={errors.term} optional>
          <Input value={params.term ?? ""} onChange={set("term")} spellCheck={false} autoComplete="off" placeholder="publico_quente…" />
        </FormField>
      </div>

      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3" aria-live="polite">
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">Link completo</p>
          <p className="font-mono text-sm break-all">{fullUrl || "Preencha a URL de destino, a origem, a mídia e a campanha."}</p>
          <div>
            <Button type="button" variant="outline" size="sm" disabled={!fullUrl} onClick={() => copy(fullUrl, "Link")}>
              <Copy aria-hidden="true" /> Copiar link
            </Button>
          </div>
        </div>
        <div className="grid gap-1 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Só os parâmetros: cole em “Parâmetros de URL” no anúncio da Meta ou em “Sufixo do URL final” no Google Ads</p>
          <p className="font-mono text-sm break-all">{query || "—"}</p>
          <div>
            <Button type="button" variant="outline" size="sm" disabled={!query} onClick={() => copy(query, "Parâmetros")}>
              <Copy aria-hidden="true" /> Copiar parâmetros
            </Button>
          </div>
        </div>
      </div>

      {canManage && (
        <form
          className="grid gap-3 border-t pt-4 md:grid-cols-[1fr_16rem_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <FormField label="Nome para salvar" error={errors.name} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" placeholder="Ex.: Oferta de pneus, Instagram…" />
          </FormField>
          <FormField label="Cliente" optional>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__sem__">Sem cliente</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />} Salvar link
          </Button>
        </form>
      )}
    </section>
  );
}

/** Links salvos, com filtro por cliente. */
export function UtmList({ links, clients, canManage }: { links: UtmLink[]; clients: AdClient[]; canManage: boolean }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("__todos__");
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const shown = links.filter((l) => clientId === "__todos__" || (clientId === "__sem__" ? !l.ad_client_id : l.ad_client_id === clientId));

  return (
    <section aria-labelledby="salvos" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="salvos" className="text-sm font-semibold">
          Links salvos ({links.length})
        </h2>
        {clients.length > 0 && (
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-56" aria-label="Filtrar links por cliente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os clientes</SelectItem>
              <SelectItem value="__sem__">Sem cliente</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!shown.length ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-6 text-sm text-muted-foreground">
          {links.length ? "Nenhum link para este cliente." : "Nenhum link salvo ainda. Monte um link acima e clique em “Salvar link” para reutilizar depois."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((l) => {
            const p = { source: l.utm_source, medium: l.utm_medium, campaign: l.utm_campaign, content: l.utm_content ?? "", term: l.utm_term ?? "" };
            const url = buildUtmUrl(l.base_url, p);
            return (
              <li key={l.id} className="grid gap-2 rounded-xl border bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium break-words">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.ad_client_id ? names.get(l.ad_client_id) : "Sem cliente"}, criado em {formatDateTime(l.created_at)}
                  </p>
                </div>
                <p className="font-mono text-xs break-all text-muted-foreground">{url}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(url, "Link")}>
                    <Copy aria-hidden="true" /> Copiar link
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copy(utmQuery(p), "Parâmetros")}>
                    <Copy aria-hidden="true" /> Copiar parâmetros
                  </Button>
                  {canManage && (
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Trash2 aria-hidden="true" /> Excluir
                        </Button>
                      }
                      title={`Excluir o link “${l.name}”?`}
                      description="O link deixa de aparecer aqui. Anúncios que já usam essas UTMs continuam funcionando."
                      confirmLabel="Excluir link"
                      onConfirm={async () => {
                        const res = await deleteUtmLink({ id: l.id });
                        if (res.ok) toast.success(res.message);
                        else toast.error(res.message);
                        router.refresh();
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
