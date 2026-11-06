import { brandSponsorActivity, creatorVideos, type Content } from "@/lib/oriane";
import { chatJSON } from "@/lib/llm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const maxDuration = 120;

const CPM = 20; // dollars per 1,000 views, a typical creator rate for short-form

type Signal = "said" | "on_screen" | "shown" | "tagged" | "caption";
type LlmBrand = {
  name: string;
  category: string;
  website_guess?: string;
  appearances: { video: number; signals: Signal[]; evidence: string; sponsored: boolean }[];
};

const SYSTEM = `You read short-form videos a creator posted and find every real commercial brand or product they feature.
Signals per video: "said" (named in the transcript), "on_screen" (in on-screen text), "shown" (clearly visible product or logo implied by on-screen text or context), "tagged" (in mentions or hashtags), "caption" (named in the caption).
Mark sponsored=true only if the video itself shows a paid relationship with that brand: #ad, #sponsored, "paid partnership", "partnered with", "thanks to X for sponsoring", a discount code or affiliate link for that brand.
Ignore: the platforms themselves (TikTok, Instagram, YouTube), the creator's own brand, music artists, generic words, people, places.
Evidence: a short verbatim quote (max 15 words) from the transcript, on-screen text or caption that proves it.
Return JSON: {"brands":[{"name":"","category":"","website_guess":"","appearances":[{"video":0,"signals":["said"],"evidence":"","sponsored":false}]}]}`;

function compact(c: Content, i: number) {
  const m = c.media?.[0];
  return {
    video: i,
    caption: (c.caption ?? c.title ?? "").slice(0, 500),
    hashtags: c.hashtags ?? [],
    mentions: (c.mentions ?? []).map((x) => x.profileHandle),
    transcript: (m?.transcript ?? "").slice(0, 1500),
    on_screen_text: (m?.onScreenText ?? []).join(" | ").slice(0, 600),
    audio: [c.audioTitle, c.audioAuthor].filter(Boolean).join(" - "),
  };
}

function findTimestamp(c: Content, brand: string) {
  const needle = brand.toLowerCase().split(" ")[0];
  const chunk = c.media?.[0]?.transcriptChunks?.find((k) => k.text.toLowerCase().includes(needle));
  if (chunk) return chunk.startSeconds;
  const frame = c.media?.[0]?.frames?.find((f) =>
    f.onScreenTextRegions?.some((r) => r.text.toLowerCase().includes(needle)),
  );
  return frame?.timestampSeconds ?? null;
}

function frameFor(c: Content, brand: string) {
  const needle = brand.toLowerCase().split(" ")[0];
  const f = c.media?.[0]?.frames?.find((fr) =>
    fr.onScreenTextRegions?.some((r) => r.text.toLowerCase().includes(needle)),
  );
  return f?.url ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return Response.json({ error: "handle required" }, { status: 400 });

  const cacheFile = path.join(process.cwd(), ".cache", `${handle}.json`);
  if (url.searchParams.get("fresh") !== "1") {
    try {
      return Response.json(JSON.parse(await readFile(cacheFile, "utf8")));
    } catch {}
  }

  try {
    const { results: videos, totalCount } = await creatorVideos(handle, 40);
    if (!videos.length) return Response.json({ error: `No indexed videos for @${handle}` }, { status: 404 });

    const ask = () => chatJSON<{ brands: LlmBrand[] }>(SYSTEM, { videos: videos.map(compact) }, 20000);
    const { brands } = await ask().catch(ask); // one retry on a truncated or malformed reply

    const ranked = brands
      .map((b) => {
        const apps = b.appearances
          .filter((a) => videos[a.video])
          .map((a) => {
            const v = videos[a.video];
            const meta = `${v.caption ?? ""} ${(v.hashtags ?? []).join(" ")} ${(v.mentions ?? []).map((m) => m.profileHandle).join(" ")}`.toLowerCase();
            const declared = meta.includes(b.name.toLowerCase().split(" ")[0]);
            return {
              ...a,
              shadow: !declared, // exposure only in what was said or shown, never tagged
              views: v.viewsCount ?? 0,
              timestamp: findTimestamp(v, b.name),
              frameUrl: frameFor(v, b.name),
              thumbnail: v.thumbnailMediaUrl,
              postUrl:
                v.platform === "tiktok"
                  ? `https://www.tiktok.com/@${v.profileHandle}/video/${v.platformId}`
                  : `https://www.instagram.com/reel/${v.platformId}/`,
              publishedAt: v.publishedAt,
            };
          });
        const free = apps.filter((a) => !a.sponsored);
        const freeViews = free.reduce((s, a) => s + a.views, 0);
        return {
          name: b.name,
          category: b.category,
          website: b.website_guess,
          appearances: apps,
          freeCount: free.length,
          sponsoredCount: apps.length - free.length,
          freeViews,
          shadowCount: free.filter((a) => a.shadow).length,
          value: Math.round((freeViews / 1000) * CPM),
        };
      })
      .filter((b) => b.freeCount > 0)
      .sort((a, b) => b.value - a.value);

    // Who is already paying creators: check the top brands against the whole Oriane index.
    const top = ranked.slice(0, 6);
    const demand = await Promise.all(top.map((b) => brandSponsorActivity(b.name).catch(() => null)));
    top.forEach((b, i) => Object.assign(b, { demand: demand[i] }));

    const v0 = videos[0];
    const result = {
      creator: {
        handle,
        name: v0.profileDisplayName ?? handle,
        avatar: v0.profilePictureUrl,
        followers: v0.profileFollowersCount ?? 0,
        platform: v0.platform,
        videosScanned: videos.length,
        videosIndexed: totalCount,
      },
      totals: {
        brands: ranked.length,
        freeMentions: ranked.reduce((s, b) => s + b.freeCount, 0),
        value: ranked.reduce((s, b) => s + b.value, 0),
        shadowShare: (() => {
          const all = ranked.reduce((s, b) => s + b.freeCount, 0);
          return all ? Math.round((100 * ranked.reduce((s, b) => s + b.shadowCount, 0)) / all) : 0;
        })(),
        cpm: CPM,
      },
      brands: ranked,
    };
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
