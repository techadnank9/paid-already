// Fallback for creators Oriane hasn't indexed: read the public Instagram profile through TinyFish's
// browser-backed Fetch API (Instagram refuses plain server requests) and collect the latest post images.
export type ProfilePosts = {
  name: string;
  followers: number;
  bio: string;
  avatar: string;
  posts: { imageUrl: string; postUrl: string }[];
};

export async function instagramPosts(handle: string): Promise<ProfilePosts | null> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [`https://www.instagram.com/${handle}/`],
      format: "markdown",
      links: true,
      image_links: true,
      per_url_timeout_ms: 60000,
      purpose: "Read a creator's public Instagram grid to find brands in their posts",
    }),
  });
  if (!res.ok) throw new Error(`TinyFish ${res.status}`);
  const r = (await res.json())?.results?.[0];
  if (!r) return null;
  const images: string[] = r.image_links ?? [];
  const postImages = images.filter((u) => u.includes("s640x640"));
  const postLinks: string[] = (r.links ?? []).filter((l: string) => /instagram\.com\/[^/]+\/(p|reel)\//.test(l));
  if (!postImages.length) return null;
  const followers = Number((r.description ?? "").match(/([\d,.]+)\s*Followers/i)?.[1]?.replace(/[,.]/g, "") ?? 0);
  const name = (r.title ?? "").match(/^(.*?)\s*\(@/)?.[1] ?? handle;
  const bio = (r.text ?? "").split("\n").slice(8, 14).join(" ").slice(0, 200);
  return {
    name,
    followers,
    bio,
    avatar: images.find((u) => u.includes("t51.2885-19")) ?? "",
    posts: postImages.slice(0, 12).map((imageUrl, i) => ({
      imageUrl,
      postUrl: (postLinks[i] ?? `https://www.instagram.com/${handle}/`).replace(`/${handle}/`, "/"),
    })),
  };
}

export async function toDataUrl(url: string) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
}
