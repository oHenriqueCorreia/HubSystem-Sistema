"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, LoaderCircle, LocateFixed, MapPin, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { WeatherIcon } from "@/domain/home";
import { findCities, saveWeatherCity } from "../actions";
import type { CityResult, Weather } from "../weather";

const ICONS: Record<WeatherIcon, typeof Sun> = {
  sol: Sun,
  "sol-nuvem": CloudSun,
  nuvem: Cloud,
  nevoa: CloudFog,
  chuva: CloudRain,
  neve: CloudSnow,
  tempestade: CloudLightning,
};

const weekday = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day))).replace(".", "");
};

export function WeatherCard({ weather, cityName }: { weather: Weather | null; cityName: string }) {
  if (!weather) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Clima · {cityName}</h2>
          <CityPicker />
        </div>
        <p className="text-sm text-muted-foreground">A previsão do tempo está indisponível agora. Tentaremos de novo em alguns minutos.</p>
      </div>
    );
  }
  const Icon = ICONS[weather.icon];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1 text-sm font-semibold">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{weather.city}</span>
        </h2>
        <CityPicker />
      </div>
      <div className="flex items-center gap-4">
        <Icon className="size-12 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="tabular text-4xl font-semibold leading-none">{weather.temperature}°C</p>
          <p className="mt-1 text-sm">{weather.label}</p>
        </div>
        <dl className="ml-auto grid gap-0.5 text-right text-sm">
          <div>
            <dt className="sr-only">Máxima e mínima</dt>
            <dd className="tabular">
              <span aria-label={`Máxima de ${weather.max} graus`}>↑ {weather.max}°</span> <span aria-label={`Mínima de ${weather.min} graus`}>↓ {weather.min}°</span>
            </dd>
          </div>
          <div>
            <dt className="sr-only">Sensação térmica</dt>
            <dd className="text-xs text-muted-foreground">Sensação {weather.apparent}°</dd>
          </div>
          {weather.rainChance != null && (
            <div>
              <dt className="sr-only">Chance de chuva</dt>
              <dd className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <Droplets className="size-3" aria-hidden="true" /> {weather.rainChance}%
              </dd>
            </div>
          )}
        </dl>
      </div>
      <ul className="grid grid-cols-3 gap-2 border-t pt-3" aria-label="Previsão dos próximos dias">
        {weather.forecast.map((d) => {
          const DIcon = ICONS[d.icon];
          return (
            <li key={d.date} className="grid justify-items-center gap-0.5 text-center text-xs">
              <span className="font-medium capitalize">{weekday(d.date)}</span>
              <DIcon className="size-5 text-muted-foreground" aria-label={d.label} />
              <span className="tabular">
                {d.max}° / {d.min}°
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Atualizado às {weather.updatedAt.slice(11, 16)} · Open-Meteo</p>
    </div>
  );
}

function CityPicker() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CityResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await findCities({ q });
      if (res.ok) setResults(res.data as CityResult[]);
      else toast.error(res.message);
    });
  }

  function choose(c: CityResult) {
    startTransition(async () => {
      const res = await saveWeatherCity(c);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.message);
    });
  }

  function locate() {
    if (!navigator.geolocation) return void toast.error("Seu navegador não permite localização.");
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: "Minha localização", latitude: Number(pos.coords.latitude.toFixed(3)), longitude: Number(pos.coords.longitude.toFixed(3)) }),
      () => toast.error("Não foi possível obter sua localização. Escolha a cidade pela busca."),
      { timeout: 10000, maximumAge: 3_600_000 },
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          Trocar cidade
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-2">
        <form onSubmit={search} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Criciúma" aria-label="Buscar cidade" autoComplete="off" />
          <Button type="submit" size="icon" variant="outline" disabled={pending || q.trim().length < 2} aria-label="Buscar">
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          </Button>
        </form>
        {results && results.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma cidade encontrada.</p>}
        {results && results.length > 0 && (
          <ul className="grid max-h-56 gap-0.5 overflow-y-auto">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button type="button" onClick={() => choose(r)} disabled={pending} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={locate} disabled={pending}>
          <LocateFixed aria-hidden="true" /> Usar minha localização
        </Button>
      </PopoverContent>
    </Popover>
  );
}
