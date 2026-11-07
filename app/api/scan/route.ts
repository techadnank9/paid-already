import { brandSponsorActivity, creatorVideos, type Content } from "@/lib/oriane";
import { chatJSON } from "@/lib/llm";
import { relay, shouldRelay } from "@/lib/relay";
import { brandComments, buildMoments, creatorStats, visualFrames } from "@/lib/proof";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

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

function publicOrigin(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://paid-already.onrender.com";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Attach the pre-rendered sponsor reel (public/reels/<handle>/<brand>.mp4) to each brand that has one.
function withReels<T extends { creator: { handle: string }; brands: { name: string; reelUrl?: string }[] }>(scan: T, origin: string) {
  for (const b of scan.brands) {
    const rel = `reels/${scan.creator.handle}/${slug(b.name)}.mp4`;
    if (existsSync(path.join(process.cwd(), "public", rel))) b.reelUrl = `${origin}/${rel}`;
  }
  return scan;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return Response.json({ error: "handle required" }, { status: 400 });

  const cacheFile = path.join(process.cwd(), ".cache", `${handle}.json`);
  const rebuild = url.searchParams.get("rebuild") === "1";
  if (url.searchParams.get("fresh") !== "1" && !rebuild) {
    try {
      return Response.json(withReels(JSON.parse(await readFile(cacheFile, "utf8")), publicOrigin(req)));
    } catch {}
  }

  if (shouldRelay()) return relay(req);

  try {
    const { results: videos, totalCount } = await creatorVideos(handle, 40);
    if (!videos.length) return Response.json(
        { error: `@${handle} isn't in Oriane's video index yet. Upload photos or screenshots of your posts and we'll find the brands in them.`, notIndexed: true },
        { status: 404 },
      );

    let brands: LlmBrand[];
    if (rebuild) {
      // Reuse the brands found last time; only recompute the evidence around them.
      const prev = JSON.parse(await readFile(cacheFile, "utf8"));
      const byId = new Map(videos.map((v, i) => [v.platformId, i]));
      brands = prev.brands.map((b: { name: string; category: string; website?: string; appearances: (LlmBrand["appearances"][number] & { postUrl: string })[] }) => ({
        name: b.name,
        category: b.category,
        website_guess: b.website,
        appearances: b.appearances
          .map((a) => ({ ...a, video: byId.get(a.postUrl.split("/").filter(Boolean).pop() ?? "") ?? -1 }))
          .filter((a) => a.video >= 0),
      }));
    } else {
      const ask = () => chatJSON<{ brands: LlmBrand[] }>(SYSTEM, { videos: videos.map(compact) }, 20000);
      ({ brands } = await ask().catch(ask)); // one retry on a truncated or malformed reply
    }

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
              platform: v.platform,
              embedUrl:
                v.platform === "tiktok"
                  ? `https://www.tiktok.com/player/v1/${v.platformId}?autoplay=1&music_info=0&description=0`
                  : `https://www.instagram.com/reel/${v.platformId}/embed`,
              caption: (v.caption ?? "").slice(0, 300),
              likes: v.likesCount ?? 0,
              comments: v.commentsCount ?? 0,
              shares: (v as { sharesCount?: number }).sharesCount ?? 0,
              moments: buildMoments(v, b.name),
              audienceComments: brandComments(v, b.name),
              platformId: v.platformId,
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

    // Product shots: Oriane vision search finds the frames that look like each top brand's product or logo.
    const visuals = await Promise.all(
      top.map((b) => visualFrames(b.name, [...new Map(b.appearances.map((a) => [a.platformId, { platform: a.platform, platformId: a.platformId }])).values()]).catch(() => null)),
    );
    top.forEach((b, i) => {
      const vis = visuals[i];
      if (!vis) return;
      for (const a of b.appearances) {
        const shots = vis.get(a.platformId);
        if (shots?.length) a.moments = buildMoments(videos.find((v) => v.platformId === a.platformId)!, b.name, shots);
      }
    });

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
        profileUrl:
          v0.platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`,
        ...creatorStats(videos),
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
    return Response.json(withReels(result, publicOrigin(req)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
