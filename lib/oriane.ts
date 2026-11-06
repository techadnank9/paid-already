const BASE = "https://connect.oriane.xyz/rest";

export type Chunk = { startSeconds: number; endSeconds: number; text: string };
export type Frame = { timestampSeconds: number; url?: string; onScreenTextRegions?: { text: string; polygon?: { x: number; y: number }[] }[] | null };
export type Media = {
  type: string;
  duration?: string | number;
  onScreenText?: string[] | null;
  transcript?: string | null;
  transcriptChunks?: Chunk[] | null;
  frames?: Frame[] | null;
};
export type Content = {
  id: string;
  platform: string;
  platformId: string;
  profileHandle: string;
  profileDisplayName?: string;
  profilePictureUrl?: string;
  profileFollowersCount?: number;
  caption?: string | null;
  title?: string | null;
  publishedAt: string;
  thumbnailMediaUrl?: string;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  interactionsCount?: number;
  hashtags?: string[];
  mentions?: { profileHandle: string }[];
  audioTitle?: string | null;
  audioAuthor?: string | null;
  media?: Media[];
};

type SearchResult = { results: Content[]; totalCount: number; totalViews: number };

export async function searchContents(
  body: unknown,
  params: Record<string, string | number> = {},
): Promise<SearchResult> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}/contents/search?${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ORIANE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Oriane ${res.status}: ${json?.error?.message ?? "error"}`);
  return {
    results: json.data?.results ?? [],
    totalCount: json.metadata?.pagination?.totalCount ?? 0,
    totalViews: json.data?.aggregations?.totalViewsCount ?? 0,
  };
}

export function creatorVideos(handle: string, limit = 40) {
  return searchContents(
    { operator: "and", filters: { profileHandle: { exactMatch: { values: [handle] } } } },
    { limit, projection: "full", sort: "publishedAt:desc" },
  );
}

// How many creators a brand has visibly paid recently: sponsored posts naming the brand.
export async function brandSponsorActivity(brand: string, days = 90) {
  const after = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const r = await searchContents(
    {
      operator: "and",
      filters: {
        publishedAt: { after },
        caption: { includesExactly: { values: ["#ad", "#sponsored", "paid partnership", "#partner", "#brandpartner"], operator: "or" } },
      },
      queries: [
        {
          operator: "or",
          filters: {
            caption: { includesExactly: { values: [brand] } },
            transcript: { includesExactly: { values: [brand] } },
            onScreenText: { includesExactly: { values: [brand] } },
          },
        },
      ],
    },
    { limit: 6, projection: "basic", sort: "viewsCount:desc" },
  );
  const creators = [...new Set(r.results.map((c) => c.profileHandle))];
  return { sponsoredPosts: r.totalCount, sampleCreators: creators.slice(0, 4) };
}
