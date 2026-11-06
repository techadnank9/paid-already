import { chatJSON } from "@/lib/llm";

const SYSTEM = `You write a short cold pitch email from a creator to a brand they have already featured for free.
Tone: confident, warm, specific, no hype words, no emojis. Under 140 words in the body.
Lead with proof: how many times they featured the brand unpaid, the views, one concrete moment (quote it).
If the brand is already paying other creators, mention it lightly ("you're already working with creators like...").
End with a clear, low-friction ask (a 3-video package or a 15-minute call).
Return JSON: {"subject":"","body":""}`;

export async function POST(req: Request) {
  const { creator, brand } = await req.json();
  try {
    const out = await chatJSON<{ subject: string; body: string }>(SYSTEM, { creator, brand }, 4000);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
