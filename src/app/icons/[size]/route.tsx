import { ImageResponse } from "next/og";

const SIZES: Record<string, { px: number; pad: number }> = {
  "192": { px: 192, pad: 0 },
  "512": { px: 512, pad: 0 },
  maskable: { px: 512, pad: 0.18 }, // área segura para ícones recortados
  apple: { px: 180, pad: 0.08 },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

/** Ícones do PWA gerados a partir da marca (nó central + três pontos). */
export async function GET(_req: Request, { params }: RouteContext<"/icons/[size]">) {
  const { size } = await params;
  const cfg = SIZES[size] ?? SIZES["512"];
  const s = cfg.px;
  const inner = s * (1 - cfg.pad * 2);
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", background: "#0e5e59" }}>
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round">
            <path d="M16 16 L9 9 M16 16 L23 9 M16 16 L16 24" />
          </g>
          <circle cx="16" cy="16" r="3.5" fill="#f0a35e" />
          <circle cx="9" cy="9" r="2" fill="#ffffff" />
          <circle cx="23" cy="9" r="2" fill="#ffffff" />
          <circle cx="16" cy="24" r="2" fill="#ffffff" />
        </svg>
      </div>
    ),
    { width: s, height: s },
  );
}
