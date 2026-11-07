import { visionJSON } from "@/lib/llm";
import { brandSponsorActivity } from "@/lib/oriane";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const maxDuration = 120;

const CPM = 20;

// For creators Oriane hasn't indexed yet: the creator uploads photos or screenshots of their posts,
// a vision model finds every brand in them, and the result has the same shape as /api/scan.
type Upload = { dataUrl: string; views?: number; caption?: string };
type Found = {
  brands: {
    name: string;
    category: string;
    website_guess?: string;
    appearances: { image: number; signals: ("shown" | "on_screen" | "caption" | "tagged")[]; evidence: string; sponsored: boolean; box?: { x0: number; y0: number; x1: number; y1: number } }[];
  }[];
};

const SYSTEM = `You look at photos a creator posted and find every real commercial brand or product visible: logos, packaging, clothing marks, storefronts, product names in on-screen or printed text, and brands named in the caption.
For each appearance give the image index (0-based), signals ("shown" for a visible product or logo, "on_screen" for written text, "caption" or "tagged" when it is in the caption), a short evidence description (what is visible, max 15 words), sponsored=true only if the caption shows a paid relationship (#ad, #sponsored, paid partnership, discount code), and a tight bounding box around the brand as fractions of the image width and height: {"x0":0.1,"y0":0.2,"x1":0.4,"y1":0.5}.
Ignore the platforms themselves, people's names and generic items with no visible brand.
Return JSON: {"brands":[{"name":"","category":"","website_guess":"","appearances":[{"image":0,"signals":["shown"],"evidence":"","sponsored":false,"box":{"x0":0,"y0":0,"x1":0,"y1":0}}]}]}`;

const frac = (n: number) => (n > 1 ? n / 1000 : n);

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { handle?: string; followers?: number; name?: string; images?: Upload[] };
    const handle = (body.handle ?? "").replace(/^@/, "").trim().toLowerCase() || "creator";
    const images = (body.images ?? []).filter((i) => i?.dataUrl?.startsWith("data:image/")).slice(0, 12);
    if (!images.length) return Response.json({ error: "Add at least one photo or screenshot." }, { status: 400 });
    const followers = Math.max(0, Number(body.followers) || 0);
    // Without platform stats, estimate each post's reach as 30% of followers.
    const estViews = (u: Upload) => (u.views && u.views > 0 ? u.views : Math.round(followers * 0.3));

    const captions = images.map((u, i) => `Image ${i} caption: ${u.caption || "(none)"}`).join("\n");
    const ask = () => visionJSON<Found>(SYSTEM, `Creator @${handle}. ${images.length} images.\n${captions}`, images.map((u) => u.dataUrl));
    const { brands } = await ask().catch(ask);

    const ranked = brands
      .map((b) => {
        const apps = b.appearances
          .filter((a) => images[a.image])
          .map((a) => {
            const u = images[a.image];
            const box = a.box && { x0: frac(a.box.x0), y0: frac(a.box.y0), x1: frac(a.box.x1), y1: frac(a.box.y1) };
            const highlights = box ? [[{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }]] : [];
            const declared = (u.caption ?? "").toLowerCase().includes(b.name.toLowerCase().split(" ")[0]);
            return {
              signals: a.signals?.length ? a.signals : ["shown"],
              evidence: a.evidence,
              sponsored: !!a.sponsored,
              shadow: !declared,
              views: estViews(u),
              timestamp: null,
              frameUrl: u.dataUrl,
              thumbnail: u.dataUrl,
              postUrl: `https://www.instagram.com/${handle}/`,
              caption: u.caption ?? "",
              moments: [{ kind: a.signals?.includes("on_screen") ? "on_screen" : "shown", t: 0, frameUrl: u.dataUrl, text: a.evidence, highlights }],
              audienceComments: [],
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
      .sort((a, b) => b.value - a.value || b.freeCount - a.freeCount);

    const top = ranked.slice(0, 6);
    const demand = await Promise.all(top.map((b) => brandSponsorActivity(b.name).catch(() => null)));
    top.forEach((b, i) => Object.assign(b, { demand: demand[i] }));

    const freeMentions = ranked.reduce((s, b) => s + b.freeCount, 0);
    const result = {
      creator: {
        handle,
        name: body.name || handle,
        avatar: "",
        followers,
        platform: "instagram",
        videosScanned: images.length,
        videosIndexed: 0,
        source: "upload",
        profileUrl: `https://www.instagram.com/${handle}/`,
      },
      totals: {
        brands: ranked.length,
        freeMentions,
        value: ranked.reduce((s, b) => s + b.value, 0),
        shadowShare: freeMentions ? Math.round((100 * ranked.reduce((s, b) => s + b.shadowCount, 0)) / freeMentions) : 0,
        cpm: CPM,
      },
      brands: ranked,
    };
    // Cache under the handle so the proof page and pitch can load it like any other scan.
    const cacheFile = path.join(process.cwd(), ".cache", `${handle}.json`);
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
