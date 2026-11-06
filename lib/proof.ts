import { searchContents, type Content, type Frame } from "./oriane";

export type Moment = {
  kind: "said" | "on_screen" | "shown";
  t: number;
  frameUrl: string | null;
  text: string;
  highlights: { x: number; y: number }[][]; // polygons (0..1) around the brand on this frame
  score?: number;
};

export function needles(brand: string) {
  const full = brand.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const first = full.split(" ")[0];
  return [...new Set([full, full.replace(/ /g, ""), first.length >= 4 ? first : full])].filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
const hit = (s: string, ns: string[]) => {
  const n = norm(s);
  return ns.some((x) => n.includes(x));
};

function nearestFrame(frames: Frame[], t: number) {
  let best: Frame | null = null;
  for (const f of frames) {
    if (!f.url) continue;
    if (!best || Math.abs(f.timestampSeconds - t) < Math.abs(best.timestampSeconds - t)) best = f;
  }
  return best;
}

type RegionFrame = Frame & { onScreenTextRegions?: { text: string; polygon?: { x: number; y: number }[] }[] | null };

export function buildMoments(v: Content, brand: string, visual: { t: number; url: string; score: number }[] = []): Moment[] {
  const ns = needles(brand);
  const m = v.media?.[0];
  const frames = (m?.frames ?? []) as RegionFrame[];
  const chunks = m?.transcriptChunks ?? [];
  const out: Moment[] = [];

  // Spoken: each transcript line naming the brand, with one line of context, paired with the closest frame.
  chunks.forEach((c, i) => {
    if (!hit(c.text, ns)) return;
    const text = [chunks[i - 1]?.text, c.text, chunks[i + 1]?.text].filter(Boolean).join(" ");
    const f = nearestFrame(frames, c.startSeconds);
    out.push({ kind: "said", t: c.startSeconds, frameUrl: f?.url ?? null, text, highlights: [] });
  });

  // On screen: frames whose recognized text contains the brand, with the text boxes to highlight.
  for (const f of frames) {
    const regions = (f.onScreenTextRegions ?? []).filter((r) => hit(r.text, ns));
    if (!regions.length || !f.url) continue;
    out.push({
      kind: "on_screen",
      t: f.timestampSeconds,
      frameUrl: f.url,
      text: regions.map((r) => r.text).join(" · "),
      highlights: regions.map((r) => r.polygon ?? []).filter((p) => p.length),
    });
  }

  // Shown: Oriane visual search's best-matching frames for the brand's product or logo.
  for (const s of visual.slice(0, 2)) {
    out.push({ kind: "shown", t: s.t, frameUrl: s.url, text: `${brand} product on screen`, highlights: [], score: s.score });
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => a.t - b.t)
    .filter((x) => {
      const k = `${x.kind}:${x.frameUrl ?? x.t}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

type WithComments = Content & { popularComments?: { profileHandle: string; content: string; likesCount: number }[] };

export function brandComments(v: Content, brand: string) {
  const ns = needles(brand);
  return ((v as WithComments).popularComments ?? [])
    .filter((c) => hit(c.content, ns))
    .slice(0, 3)
    .map((c) => ({ handle: c.profileHandle, text: c.content, likes: c.likesCount }));
}

// Ask Oriane's vision index which frames of these videos look like the brand's product or logo.
export async function visualFrames(brand: string, ids: { platform: string; platformId: string }[]) {
  const map = new Map<string, { t: number; url: string; score: number }[]>();
  if (!ids.length) return map;
  const res = await fetch("https://connect.oriane.xyz/rest/assets", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ORIANE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "text", text: `${brand} logo or product packaging` }),
  });
  const assetId = (await res.json())?.data?.id;
  if (!assetId) return map;
  const r = await searchContents(
    {
      operator: "and",
      filters: {
        platformId: { includes: ids },
        visualSimilarity: { includes: { values: [{ assetId, minScore: 0.25 }] } },
      },
    },
    { limit: Math.min(ids.length, 20), projection: "full", sort: "visualSimilarity" },
  );
  for (const v of r.results) {
    const frames = (v.media?.[0]?.frames ?? []) as (Frame & { visualSimilarityScore?: number })[];
    const top = frames
      .filter((f) => f.url && (f.visualSimilarityScore ?? 0) > 0)
      .sort((a, b) => (b.visualSimilarityScore ?? 0) - (a.visualSimilarityScore ?? 0))
      .slice(0, 2)
      .map((f) => ({ t: f.timestampSeconds, url: f.url!, score: Math.round((f.visualSimilarityScore ?? 0) * 100) / 100 }));
    map.set(v.platformId, top);
  }
  return map;
}

export function creatorStats(videos: Content[]) {
  const views = videos.map((v) => v.viewsCount ?? 0).sort((a, b) => a - b);
  const er = videos
    .map((v) => (v as Content & { engagementRatePerViews?: number }).engagementRatePerViews)
    .filter((x): x is number => typeof x === "number");
  const bio = (videos[0] as Content & { profileBio?: string }).profileBio ?? "";
  return {
    bio,
    businessEmail: bio.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null,
    avgViews: Math.round(views.reduce((s, x) => s + x, 0) / (views.length || 1)),
    medianViews: views[Math.floor(views.length / 2)] ?? 0,
    totalViews: views.reduce((s, x) => s + x, 0),
    avgEngagementRate: er.length ? Math.round((10 * er.reduce((s, x) => s + x, 0)) / er.length) / 10 : null,
  };
}
