import type { DeliveryFileKind, DeliveryStatus } from "@/domain/deliveries";

export const DELIVERIES_BUCKET = "task-deliveries";
export const FEEDBACK_BUCKET = "task-delivery-feedback";

export type DeliveryFile = { id: string; kind: DeliveryFileKind; storage_path: string | null; drive_file_id: string | null; file_name: string; mime: string | null; size_bytes: number | null; url: string | null };

export type DeliveryReview = {
  id: string;
  version: number;
  decision: "aprovado" | "recusado" | "comentario";
  comment: string | null;
  reviewer_name: string;
  created_at: string;
  files: { id: string; kind: "audio" | "imagem"; url: string | null }[];
};

export type Delivery = {
  id: string;
  task_id: string;
  kind: string;
  title: string;
  notes: string | null;
  maker_id: string | null;
  maker_name: string | null;
  maker_role: string | null;
  status: DeliveryStatus;
  version: number;
  created_at: string;
  files: DeliveryFile[];
  reviews: DeliveryReview[];
};
