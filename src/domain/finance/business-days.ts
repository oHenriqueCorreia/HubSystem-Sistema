// Mesma regra do banco (private.is_business_day / private.nth_business_day):
// segunda a sexta, fora feriados nacionais e bancários (Carnaval, Sexta-feira Santa e Corpus Christi pela Páscoa).

const FIXED = new Set(["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utc(year, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

export function isBusinessDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6 || FIXED.has(date.slice(5))) return false;
  const e = easter(d.getUTCFullYear()).getTime();
  const day = 86_400_000;
  return ![e - 48 * day, e - 47 * day, e - 2 * day, e + 60 * day].includes(d.getTime());
}

/** N-ésimo dia útil do mês "AAAA-MM" (ou o último dia útil, se o mês tiver menos). */
export function nthBusinessDay(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  let found = "";
  for (let day = 1; day <= last; day++) {
    const date = iso(utc(y, m, day));
    if (!isBusinessDay(date)) continue;
    count++;
    found = date;
    if (count === n) return date;
  }
  return found;
}

const addMonths = (month: string, k: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return iso(d).slice(0, 7);
};

const STEP = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 } as const;

/** Próximos vencimentos de uma conta fixa (prévia do formulário). */
export function upcomingDueDates(o: { startMonth: string; frequency: keyof typeof STEP; rule: "dia_fixo" | "dia_util"; day: number; count: number }) {
  const out: string[] = [];
  for (let i = 0; out.length < o.count && i < o.count * 12; i++) {
    const month = addMonths(o.startMonth, i * STEP[o.frequency]);
    if (o.rule === "dia_util") out.push(nthBusinessDay(month, o.day));
    else {
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      out.push(`${month}-${String(Math.min(o.day, last)).padStart(2, "0")}`);
    }
  }
  return out;
}
