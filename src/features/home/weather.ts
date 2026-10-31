import "server-only";
import { weatherLabel, type City, type WeatherIcon } from "@/domain/home";

export type Weather = {
  city: string;
  temperature: number;
  apparent: number;
  label: string;
  icon: WeatherIcon;
  max: number;
  min: number;
  rainChance: number | null;
  forecast: { date: string; max: number; min: number; label: string; icon: WeatherIcon; rainChance: number | null }[];
  updatedAt: string;
};

type OpenMeteo = {
  current?: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number };
  daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
};

/**
 * Previsão da Open-Meteo (gratuita, sem chave). Dado público, não depende do
 * usuário: pode ficar em cache por 30 minutos. Retorna null se indisponível.
 */
export async function getWeather(city: City): Promise<Weather | null> {
  const q = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: "temperature_2m,apparent_temperature,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "America/Sao_Paulo",
    forecast_days: "4",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q.toString()}`, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as OpenMeteo;
    const daily = d.daily;
    if (!d.current || !daily?.time?.length) return null;
    const now = weatherLabel(d.current.weather_code);
    const days = daily.time.map((date, i) => {
      const w = weatherLabel(daily.weather_code[i]);
      return {
        date,
        max: Math.round(daily.temperature_2m_max[i]),
        min: Math.round(daily.temperature_2m_min[i]),
        label: w.label,
        icon: w.icon,
        rainChance: daily.precipitation_probability_max?.[i] ?? null,
      };
    });
    return {
      city: city.name,
      temperature: Math.round(d.current.temperature_2m),
      apparent: Math.round(d.current.apparent_temperature),
      label: now.label,
      icon: now.icon,
      max: days[0].max,
      min: days[0].min,
      rainChance: days[0].rainChance,
      forecast: days.slice(1),
      // Horário da medição informado pela Open-Meteo (já em São Paulo, sem fuso).
      updatedAt: d.current.time,
    };
  } catch {
    return null;
  }
}

export type CityResult = { name: string; latitude: number; longitude: number };

export async function searchCities(query: string): Promise<CityResult[]> {
  const q = new URLSearchParams({ name: query, count: "6", language: "pt", format: "json" });
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q.toString()}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { results?: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }[] };
    return (d.results ?? []).map((r) => ({
      name: [r.name, r.admin1, r.country_code && r.country_code !== "BR" ? r.country_code : null].filter(Boolean).join(", "),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  } catch {
    return [];
  }
}
