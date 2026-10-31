import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TagColor } from "@/features/crm/types";

export type TagRow = {
  id: string;
  name: string;
  color: TagColor;
  description: string | null;
  archived_at: string | null;
  leads: number;
  tasks: number;
};

/** Etiquetas da organização com quantos leads e tarefas usam cada uma. */
export async function listTagsWithUsage(): Promise<TagRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color, description, archived_at, lead_tags(count), task_tags(count)")
    .order("archived_at", { nullsFirst: true })
    .order("name");
  if (error) throw error;
  const n = (v: unknown) => (v as { count: number }[] | null)?.[0]?.count ?? 0;
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color as TagColor,
    description: t.description,
    archived_at: t.archived_at,
    leads: n(t.lead_tags),
    tasks: n(t.task_tags),
  }));
}
