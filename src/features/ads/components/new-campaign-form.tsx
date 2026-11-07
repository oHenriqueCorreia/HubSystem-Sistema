"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, LoaderCircle, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/app/form-field";
import { MoneyInput } from "@/components/app/money-input";
import { formatBRL } from "@/domain/shared/money";
import { createMetaCampaign, loadMetaPages, searchMetaLocations } from "../create-actions";

type Account = { id: string; name: string };
type Place = { key: string; type: "city" | "region"; label: string; radiusKm: number };

const OBJECTIVES = [
  { key: "whatsapp", title: "Mensagens no WhatsApp", detail: "Quem clica abre uma conversa no WhatsApp da página." },
  { key: "trafego", title: "Tráfego para o site", detail: "Leva pessoas para um link (site, loja, cardápio)." },
  { key: "alcance", title: "Alcance", detail: "Mostra o anúncio para o maior número de pessoas da região." },
] as const;

const CTAS = [
  ["LEARN_MORE", "Saiba mais"],
  ["SHOP_NOW", "Comprar agora"],
  ["SIGN_UP", "Cadastre-se"],
  ["CONTACT_US", "Fale conosco"],
  ["GET_QUOTE", "Solicitar orçamento"],
  ["BOOK_TRAVEL", "Reservar"],
] as const;

const AGES = Array.from({ length: 48 }, (_, i) => i + 18);

/** Reduz para no máximo 1600px e JPEG: cabe no limite de envio e a Meta aceita bem. */
async function compress(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { url, base64: url.slice(url.indexOf(",") + 1) };
}

export function NewCampaignForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [objective, setObjective] = useState<"whatsapp" | "trafego" | "alcance">("whatsapp");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState<number | null>(2000);
  const [brazil, setBrazil] = useState(true);
  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Omit<Place, "radiusKm">[]>([]);
  const [searching, setSearching] = useState(false);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<"todos" | "homens" | "mulheres">("todos");
  const [pages, setPages] = useState<{ id: string; name: string }[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pagesTry, setPagesTry] = useState(0);
  const [pageId, setPageId] = useState("");
  const [image, setImage] = useState<{ url: string; base64: string } | null>(null);
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [link, setLink] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [active, setActive] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Páginas do Facebook: carregadas uma vez ao abrir.
  useEffect(() => {
    let alive = true;
    loadMetaPages({}).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setPages(res.data);
        setPagesError(null);
        if (res.data.length === 1) setPageId(res.data[0].id);
      } else setPagesError(res.message);
    });
    return () => {
      alive = false;
    };
  }, [pagesTry]);

  // Busca de cidades e estados, com espera curta entre teclas.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchMetaLocations({ q: query });
      setSearching(false);
      if (res.ok) setResults(res.data);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const payload = (validateOnly: boolean) => ({
    accountId,
    objective,
    name,
    dailyBudgetCents: budget ?? 0,
    active,
    countries: brazil && !places.length ? ["BR"] : [],
    cities: places.filter((p) => p.type === "city").map((p) => ({ key: p.key, radiusKm: p.radiusKm })),
    regions: places.filter((p) => p.type === "region").map((p) => p.key),
    ageMin,
    ageMax,
    genders: gender === "todos" ? [] : [gender],
    pageId,
    imageBase64: image?.base64 ?? null,
    message,
    headline,
    link: objective === "whatsapp" ? null : link,
    cta: (objective === "whatsapp" ? "WHATSAPP_MESSAGE" : cta) as never,
    validateOnly,
  });

  function submit(validateOnly: boolean) {
    setErrors({});
    start(async () => {
      const res = await createMetaCampaign(payload(validateOnly));
      if (!res.ok) {
        setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
        toast.error(res.message);
        return;
      }
      toast.success(res.message);
      if (validateOnly) return setChecked(true);
      router.push(res.data.campaignId ? "/anuncios/campanhas" : "/anuncios");
      router.refresh();
    });
  }

  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      onChange={() => setChecked(false)}
    >
      <fieldset className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5">
        <legend className="px-1 text-base font-semibold">Objetivo e orçamento</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Conta de anúncio">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Nome da campanha" error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Rodízio de sexta – Novembro…" maxLength={200} autoComplete="off" />
          </FormField>
        </div>
        <div role="radiogroup" aria-label="Objetivo" className="grid gap-2 sm:grid-cols-3">
          {OBJECTIVES.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={objective === o.key}
              onClick={() => setObjective(o.key)}
              className={cn(
                "grid gap-1 rounded-lg border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                objective === o.key ? "border-primary bg-primary/5" : "hover:border-foreground/30",
              )}
            >
              <span className="font-medium">{o.title}</span>
              <span className="text-xs text-muted-foreground">{o.detail}</span>
            </button>
          ))}
        </div>
        <FormField label="Orçamento por dia" error={errors.dailyBudgetCents} hint={budget ? `Cerca de ${formatBRL(budget * 30)} por mês.` : undefined}>
          <MoneyInput value={budget} onChange={setBudget} className="w-48" />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5">
        <legend className="px-1 text-base font-semibold">Público</legend>
        <div className="grid gap-2">
          <FormField label="Onde mostrar" error={errors.countries} hint="Busque cidades ou estados. Sem nenhum, o anúncio vale para o Brasil todo.">
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: Araranguá…" autoComplete="off" />
          </FormField>
          {query.trim().length >= 2 && (
            <ul className="grid max-h-56 overflow-y-auto rounded-lg border" aria-label="Locais encontrados">
              {searching && <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li>}
              {!searching &&
                results.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        if (!places.some((p) => p.key === r.key)) setPlaces((p) => [...p, { ...r, radiusKm: 17 }]);
                        setQuery("");
                        setResults([]);
                        setBrazil(false);
                      }}
                    >
                      <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
                      {r.label}
                      <span className="text-xs text-muted-foreground">{r.type === "city" ? "cidade" : "estado"}</span>
                    </button>
                  </li>
                ))}
              {!searching && !results.length && <li className="px-3 py-2 text-sm text-muted-foreground">Nenhum local com “{query}”.</li>}
            </ul>
          )}
          <ul className="flex flex-wrap gap-2">
            {!places.length && <li className="rounded-full border bg-background px-3 py-1 text-sm">Brasil</li>}
            {places.map((p) => (
              <li key={p.key} className="flex items-center gap-2 rounded-full border bg-background py-1 pr-1 pl-3 text-sm">
                {p.label}
                {p.type === "city" && (
                  <select
                    aria-label={`Raio em volta de ${p.label}`}
                    value={p.radiusKm}
                    onChange={(e) => setPlaces((all) => all.map((x) => (x.key === p.key ? { ...x, radiusKm: Number(e.target.value) } : x)))}
                    className="rounded border bg-background px-1 text-xs text-foreground"
                  >
                    {[1, 5, 10, 17, 25, 40, 80].map((km) => (
                      <option key={km} value={km}>
                        +{km} km
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={() => setPlaces((all) => all.filter((x) => x.key !== p.key))} className="rounded-full p-1 hover:bg-muted" aria-label={`Remover ${p.label}`}>
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Idade mínima" error={errors.ageMin}>
            <Select value={String(ageMin)} onValueChange={(v) => setAgeMin(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGES.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Idade máxima">
            <Select value={String(ageMax)} onValueChange={(v) => setAgeMax(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGES.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a === 65 ? "65+" : a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Gênero">
            <Select value={gender} onValueChange={(v) => setGender(v as typeof gender)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="mulheres">Mulheres</SelectItem>
                <SelectItem value="homens">Homens</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5">
        <legend className="px-1 text-base font-semibold">Anúncio</legend>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid content-start gap-4">
            <FormField label="Página do Facebook" error={errors.pageId ?? pagesError ?? undefined} hint="O anúncio aparece em nome dela.">
              <Select value={pageId || undefined} onValueChange={setPageId} disabled={!pages}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={pages ? (pages.length ? "Escolha a página" : "Nenhuma página encontrada") : pagesError ? "Páginas indisponíveis" : "Carregando páginas…"} />
                </SelectTrigger>
                <SelectContent>
                  {(pages ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {pagesError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="-mt-2 justify-self-start"
                onClick={() => {
                  setPagesError(null);
                  setPagesTry((n) => n + 1);
                }}
              >
                Tentar de novo
              </Button>
            )}
            <FormField label="Texto principal" error={errors.message}>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} placeholder="Ex.: Rodízio completo toda sexta a partir das 19h…" />
            </FormField>
            <FormField label="Título" optional>
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={255} autoComplete="off" placeholder="Ex.: Reserve sua mesa…" />
            </FormField>
            {objective !== "whatsapp" && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
                <FormField label="Link de destino" error={errors.link}>
                  <Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} />
                </FormField>
                <FormField label="Botão">
                  <Select value={cta} onValueChange={setCta}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CTAS.map(([k, l]) => (
                        <SelectItem key={k} value={k}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            )}
          </div>
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Imagem</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Escolher imagem do anúncio"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 25 * 1024 * 1024) return void toast.error("Imagem muito grande. Use uma de até 25 MB.");
                setImage(await compress(f));
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid aspect-square place-items-center overflow-hidden rounded-xl border border-dashed bg-muted/40 text-sm text-muted-foreground hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt="Prévia da imagem do anúncio" width={320} height={320} className="size-full object-cover" />
              ) : (
                <span className="grid justify-items-center gap-2 p-4 text-center">
                  <ImagePlus className="size-6" aria-hidden="true" />
                  Escolher imagem
                  <span className="text-xs">Quadrada (1080×1080) funciona em todos os lugares.</span>
                </span>
              )}
            </button>
            {image && (
              <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setImage(null)}>
                Remover imagem
              </Button>
            )}
          </div>
        </div>
      </fieldset>

      <section aria-labelledby="publicar" className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5">
        <h2 id="publicar" className="text-base font-semibold">
          Publicar
        </h2>
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 text-sm">
          <span className="grid gap-0.5">
            <span className="font-medium">Já começar ativa</span>
            <span className="text-xs text-muted-foreground">Desligado, a campanha é criada pausada para você revisar no sistema ou na Meta.</span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} className="mt-0.5 shrink-0" />
        </label>
        {checked && (
          <FormAlert tone="success">
            <CheckCircle2 className="mr-1 inline size-4" aria-hidden="true" /> A Meta conferiu a campanha. Pode criar.
          </FormAlert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !accountId}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />} {active ? "Criar e publicar" : "Criar pausada"}
          </Button>
          <Button type="button" variant="outline" disabled={pending || !accountId} onClick={() => submit(true)}>
            Conferir com a Meta
          </Button>
        </div>
      </section>
    </form>
  );
}
