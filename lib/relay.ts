// Until the API keys are set on the host, forward work to a machine that has them.
const RELAY = "https://equipment-amy-stat-compression.trycloudflare.com";

export function shouldRelay() {
  return !process.env.LLM_API_KEY || !process.env.ORIANE_API_KEY;
}

export async function relay(req: Request, body?: string) {
  const url = new URL(req.url);
  const res = await fetch(`${RELAY}${url.pathname}${url.search}`, {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}
