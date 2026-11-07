import { spawn } from "node:child_process";

function parseJSON<T>(text: string): T {
  const start = text.indexOf("{");
  return JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as T;
}

// Local fallback: the Claude Code CLI on this machine, used when no API key is configured.
function viaClaudeCli(system: string, user: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--model", process.env.CLI_MODEL ?? "sonnet", "--output-format", "text"], {
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`claude cli ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(`${system}\n\nReply with the JSON object only.\n\nINPUT:\n${user}`);
  });
}

// OpenAI-compatible chat call. Points at GMI Cloud (api.gmi-serving.com/v1) by default.
export async function chatJSON<T>(system: string, user: unknown, maxTokens = 6000): Promise<T> {
  const userText = typeof user === "string" ? user : JSON.stringify(user);
  if (!process.env.LLM_API_KEY) return parseJSON<T>(await viaClaudeCli(system, userText));

  const base = process.env.LLM_BASE_URL ?? "https://api.gmi-serving.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return parseJSON<T>(json.choices?.[0]?.message?.content ?? "{}");
}

// Vision variant: same call, with images attached as data URLs.
export async function visionJSON<T>(system: string, text: string, images: string[], maxTokens = 8000): Promise<T> {
  const res = await fetch(`${process.env.LLM_BASE_URL ?? "https://api.gmi-serving.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return parseJSON<T>(json.choices?.[0]?.message?.content ?? "{}");
}
