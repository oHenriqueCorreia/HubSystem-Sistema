import { NextResponse, type NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { getCurrentUser } from "@/lib/auth/dal";

export const maxDuration = 30;

// A Vercel limita o corpo a 4,5 MB.
const MAX_BYTES = 4 * 1024 * 1024;

/** Só extrai o texto do PDF para a revisão. Nada é gravado aqui, e o arquivo não fica guardado. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(user.permissions["finance.company.create"] || user.permissions["finance.personal.manage"])) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("arquivo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo PDF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "O PDF passa de 4 MB. Exporte um período menor ou use OFX ou CSV." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ error: "Este arquivo não é um PDF válido." }, { status: 415 });
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    const lines = (text as string[]).flatMap((page) => page.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return NextResponse.json({ error: "Este PDF não tem texto para ler: parece uma imagem escaneada. Use OFX ou CSV do banco." }, { status: 422 });
    return NextResponse.json({ lines: lines.slice(0, 20000) });
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o PDF. Se ele tiver senha, exporte sem senha ou use OFX ou CSV." }, { status: 422 });
  }
}
