export type MetaAction = { action_type: string; value: string };

// Ações da Meta contadas como conversão.
const CONVERSION_ACTIONS = new Set([
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "onsite_conversion.lead_grouped",
  "complete_registration",
  "onsite_conversion.messaging_conversation_started_7d",
]);

// "purchase" e "lead" já agregam as versões do pixel/formulário; somar as duas dobraria o número.
const ALIAS_OF: Record<string, string> = { "offsite_conversion.fb_pixel_purchase": "purchase", "onsite_conversion.lead_grouped": "lead" };

/** Soma de `actions` (quantidade) ou `action_values` (valor) da Meta, sem contar o mesmo evento duas vezes. */
export function sumConversionActions(list: MetaAction[]) {
  const types = new Set(list.map((a) => a.action_type));
  return list
    .filter((a) => CONVERSION_ACTIONS.has(a.action_type) && !(ALIAS_OF[a.action_type] && types.has(ALIAS_OF[a.action_type])))
    .reduce((s, a) => s + Number(a.value), 0);
}
