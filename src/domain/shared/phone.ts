import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

export type NormalizedPhone = { e164: string; national: string; type: "celular" | "fixo" | "desconhecido" };

/**
 * Normaliza um telefone para E.164. Números sem DDI são tratados como do Brasil.
 * Retorna null quando o número não é válido.
 */
export function normalizePhone(raw: string | null | undefined, country: CountryCode = "BR"): NormalizedPhone | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const parsed = parsePhoneNumberFromString(cleaned, country);
  if (!parsed || !parsed.isValid()) return null;

  const t = parsed.getType();
  const type = t === "MOBILE" ? "celular" : t === "FIXED_LINE" ? "fixo" : guessBrType(parsed.nationalNumber);
  return { e164: parsed.number, national: parsed.formatNational(), type };
}

// O metadado "min" não traz o tipo; no Brasil, celulares têm 9 dígitos começando por 9.
function guessBrType(national: string): NormalizedPhone["type"] {
  if (/^\d{2}9\d{8}$/.test(national)) return "celular";
  if (/^\d{2}[2-5]\d{7}$/.test(national)) return "fixo";
  return "desconhecido";
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "BR" ? parsed.formatNational() : parsed.formatInternational();
}

/** Link do WhatsApp (wa.me) com mensagem preenchida. Não envia nada sozinho. */
export function whatsappLink(e164: string, message?: string): string {
  const digits = e164.replace(/\D/g, "");
  const text = message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : "";
  return `https://wa.me/${digits}${text}`;
}

/** Substitui variáveis {nome}, {empresa}... em mensagens modelo. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value == null || value === "" ? match : value;
  });
}

/**
 * Formas equivalentes de um celular brasileiro em E.164. O WhatsApp costuma
 * informar números sem o 9º dígito (ex.: +55 48 8812-3456 para 98812-3456);
 * comparamos as duas formas para achar o lead e evitar duplicados.
 */
export function brPhoneVariants(e164: string): string[] {
  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return [e164];
  const [, ddd, num] = m;
  if (num.length === 9 && num.startsWith("9")) return [e164, `+55${ddd}${num.slice(1)}`];
  if (num.length === 8 && /^[6-9]/.test(num)) return [e164, `+55${ddd}9${num}`];
  return [e164];
}

/** wa_id do WhatsApp (só dígitos, com DDI) → E.164 normalizado (com o 9º dígito no Brasil). */
export function waIdToE164(waId: string): string | null {
  const digits = waId.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const br = digits.match(/^55(\d{2})(\d{8})$/);
  if (br && /^[6-9]/.test(br[2])) return `+55${br[1]}9${br[2]}`;
  return `+${digits}`;
}
