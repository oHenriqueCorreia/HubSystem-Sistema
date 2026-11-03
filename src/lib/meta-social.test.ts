import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_SITE_URL: "https://site.test" } }));

import { instagramContainer, publishFacebook, type MediaPlan } from "./meta-social";

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };

let calls: Call[];
const replies: [RegExp, unknown][] = [];

beforeEach(() => {
  calls = [];
  replies.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null, headers: (init.headers ?? {}) as Record<string, string> });
    const match = replies.find(([re]) => re.test(url));
    return new Response(JSON.stringify(match ? match[1] : {}), { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const story = (over: Partial<MediaPlan>): MediaPlan => ({ imageUrls: [], videoUrl: null, caption: "", format: "stories", ...over });

describe("stories no Instagram", () => {
  it("imagem usa STORIES, sem legenda", async () => {
    replies.push([/\/ig\/media/, { id: "c1" }]);
    await expect(instagramContainer("ig", "t", story({ imageUrls: ["https://x/a.jpg"], caption: "ignorada" }))).resolves.toBe("c1");
    expect(calls[0].body).toEqual({ media_type: "STORIES", image_url: "https://x/a.jpg" });
  });

  it("vídeo usa STORIES com video_url", async () => {
    replies.push([/\/ig\/media/, { id: "c2" }]);
    await instagramContainer("ig", "t", story({ videoUrl: "https://x/v.mp4" }));
    expect(calls[0].body).toEqual({ media_type: "STORIES", video_url: "https://x/v.mp4" });
  });

  it("reels continua como reels", async () => {
    replies.push([/\/ig\/media/, { id: "c3" }]);
    await instagramContainer("ig", "t", { imageUrls: [], videoUrl: "https://x/v.mp4", caption: "Oi", format: "reels" });
    expect(calls[0].body).toEqual({ media_type: "REELS", video_url: "https://x/v.mp4", caption: "Oi" });
  });
});

describe("stories no Facebook", () => {
  it("foto sobe sem publicar e vira story", async () => {
    replies.push([/\/p1\/photos/, { id: "foto1" }], [/\/p1\/photo_stories/, { post_id: "post1", success: true }]);
    const r = await publishFacebook("p1", "t", story({ imageUrls: ["https://x/a.jpg"] }));
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["photos", "photo_stories"]);
    expect(calls[0].body).toEqual({ url: "https://x/a.jpg", published: false });
    expect(calls[1].body).toEqual({ photo_id: "foto1" });
    expect(r).toEqual({ done: true, externalId: "post1", permalink: null });
  });

  it("vídeo abre o envio, manda o link, espera ficar pronto e publica", async () => {
    replies.push([/rupload/, { success: true }], [/\/vid1\?fields=status/, { status: { video_status: "ready" } }], [/\/p1\/video_stories/, { video_id: "vid1", upload_url: "https://rupload.facebook.com/video-upload/v23.0/vid1", post_id: "post2" }]);
    const r = await publishFacebook("p1", "t", story({ videoUrl: "https://x/v.mp4" }));
    expect(calls[0].body).toEqual({ upload_phase: "start" });
    expect(calls[1].url).toContain("rupload");
    expect(calls[1].headers.file_url).toBe("https://x/v.mp4");
    expect(calls[2].url).toContain("vid1?fields=status");
    expect(calls[3].body).toEqual({ upload_phase: "finish", video_id: "vid1" });
    expect(r).toEqual({ done: true, externalId: "post2", permalink: null });
  });

  it("vídeo que o Facebook rejeita vira erro, sem publicar", async () => {
    replies.push([/rupload/, { success: true }], [/\/vid1\?fields=status/, { status: { video_status: "error" } }], [/\/p1\/video_stories/, { video_id: "vid1" }]);
    await expect(publishFacebook("p1", "t", story({ videoUrl: "https://x/v.mp4" }))).rejects.toMatchObject({ detail: expect.stringContaining("processar") });
    expect(calls.some((c) => c.body?.upload_phase === "finish")).toBe(false);
  });
});
