"""Cut a 9:16 sponsor reel for one creator x brand from a cached scan.

Usage: .venv-reel/bin/python scripts/reel.py <handle> "<Brand>"
Writes public/reels/<handle>/<brand-slug>.mp4
"""
import io, json, os, re, subprocess, sys, tempfile
import requests
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
LIME = (200, 241, 105)
BG = (11, 11, 12)
INK = (242, 240, 234)
MUTED = (141, 138, 130)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def font(size, bold=True):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def fetch(url):
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception:
        return None


def fmt(n):
    return f"{n/1e6:.1f}M" if n >= 1e6 else f"{round(n/1e3)}K" if n >= 1e3 else str(n)


def clean(text):
    return re.sub(r"\b(fuck|shit|bitch)(\w*)", lambda m: m.group(1)[0] + "*" * (len(m.group(1)) - 1) + m.group(2), text, flags=re.I)


def excerpt(text, brand, width=120):
    """Window the quote around the first mention of the brand so the name is always visible."""
    key = brand.lower().split()[0].strip('"')
    i = text.lower().find(key)
    if i < 0 or len(text) <= width:
        return text[:width]
    start = max(0, i - width // 3)
    out = text[start : start + width]
    return ("…" if start else "") + out.strip() + ("…" if start + width < len(text) else "")


def ts(t):
    return f"{int(t//60)}:{int(t%60):02d}"


def branding(brand, website):
    key = os.environ.get("FIRECRAWL_API_KEY")
    url = website if website and website.startswith("http") else f"https://www.{slug(brand).replace('-', '')}.com"
    if not key:
        return {}
    try:
        r = requests.post(
            "https://api.firecrawl.dev/v2/scrape",
            headers={"Authorization": f"Bearer {key}"},
            json={"url": url, "formats": ["branding"]},
            timeout=60,
        )
        return r.json().get("data", {}).get("branding") or {}
    except Exception:
        return {}


def hex_rgb(h, fallback):
    try:
        h = h.lstrip("#")
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return fallback


def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    img = img.resize((int(img.width * s), int(img.height * s)))
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h)), s, x, y


def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def title_card(creator, brand, b, accent):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    av = fetch(creator.get("avatar") or "")
    if av:
        av = av.resize((220, 220))
        mask = Image.new("L", (220, 220), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 220, 220), fill=255)
        im.paste(av, (W // 2 - 110, 420), mask)
    d.text((W // 2, 720), f"@{creator['handle']}", font=font(56), fill=INK, anchor="mm")
    d.text((W // 2, 800), "×", font=font(80), fill=MUTED, anchor="mm")
    d.text((W // 2, 900), brand, font=font(110), fill=accent, anchor="mm")
    y = 1080
    for line in [f"Featured {b['freeCount']}× — unpaid", f"{fmt(b['freeViews'])} views of free exposure", f"Worth ${b['value']:,} at $20 CPM"]:
        d.text((W // 2, y), line, font=font(54, False), fill=INK, anchor="mm")
        y += 90
    d.text((W // 2, H - 140), "OWED", font=font(36), fill=LIME, anchor="mm")
    return im


def moment_card(frame_url, m, brand, a, accent):
    src = fetch(frame_url) if frame_url else None
    im = Image.new("RGB", (W, H), BG)
    if src:
        bg = cover(src, W, H)[0].filter(ImageFilter.GaussianBlur(30))
        im = Image.blend(bg, Image.new("RGB", (W, H), BG), 0.55)
        fw = 860
        fh = min(int(fw * 16 / 9), 1340)
        frame, s, ox, oy = cover(src, fw, fh)
        fx, fy = (W - fw) // 2, 150
        im.paste(frame, (fx, fy))
        d = ImageDraw.Draw(im)
        for poly in m.get("highlights") or []:
            pts = [(fx + p["x"] * src.width * s - ox, fy + p["y"] * src.height * s - oy) for p in poly]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            d.rounded_rectangle((min(xs) - 14, min(ys) - 10, max(xs) + 14, max(ys) + 10), radius=12, outline=LIME, width=8)
        d.rounded_rectangle((fx, fy, fx + fw, fy + fh), radius=28, outline=(36, 35, 31), width=4)
    d = ImageDraw.Draw(im)
    label = {"said": "SAID IT", "on_screen": "ON SCREEN", "shown": "PRODUCT SHOWN"}.get(m["kind"], m["kind"].upper())
    chip = f"{label} · {ts(m['t'])}"
    cw = d.textlength(chip, font=font(40)) + 60
    d.rounded_rectangle(((W - cw) / 2, 1510, (W + cw) / 2, 1580), radius=35, fill=LIME)
    d.text((W // 2, 1545), chip, font=font(40), fill=BG, anchor="mm")
    text = clean(excerpt(m["text"], brand)) if m["kind"] != "shown" else f"{brand} on screen"
    y = 1640
    for line in wrap(d, f"“{text}”", font(50, False), W - 140)[:3]:
        d.text((W // 2, y), line, font=font(50, False), fill=INK, anchor="mm")
        y += 66
    d.text((W // 2, H - 70), f"{fmt(a['views'])} views", font=font(36), fill=MUTED, anchor="mm")
    return im


def end_card(creator, brand, brandinfo, accent):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    imgs = brandinfo.get("images") or {}
    logo = fetch(imgs.get("ogImage") or "") or fetch(imgs.get("favicon") or "")
    if logo:
        logo.thumbnail((760, 520))
        pad = Image.new("RGB", (logo.width + 80, logo.height + 80), (255, 255, 255))
        pad.paste(logo, (40, 40))
        im.paste(pad, ((W - pad.width) // 2, 380))
    else:
        d.text((W // 2, 600), brand, font=font(130), fill=accent, anchor="mm")
    d.text((W // 2, 1100), "Ready to make it official?", font=font(68), fill=INK, anchor="mm")
    d.text((W // 2, 1200), f"@{creator['handle']} · {fmt(creator.get('followers', 0))} followers", font=font(48, False), fill=MUTED, anchor="mm")
    if creator.get("avgEngagementRate"):
        d.text((W // 2, 1280), f"{creator['avgEngagementRate']}% engagement · {fmt(creator.get('avgViews', 0))} avg views", font=font(48, False), fill=MUTED, anchor="mm")
    if creator.get("businessEmail"):
        d.text((W // 2, 1420), creator["businessEmail"], font=font(46), fill=LIME, anchor="mm")
    d.text((W // 2, H - 140), "OWED", font=font(36), fill=LIME, anchor="mm")
    return im


def render(handle, brand_name):
    data = json.load(open(os.path.join(ROOT, ".cache", f"{handle}.json")))
    creator = data["creator"]
    b = next(x for x in data["brands"] if x["name"].lower() == brand_name.lower())
    info = branding(b["name"], b.get("website"))
    colors = info.get("colors") or {}
    accent = hex_rgb(colors.get("accent") or colors.get("primary") or "", LIME)
    if sum(accent) < 120:  # too dark to read on black
        accent = LIME
    cards = [(title_card(creator, b["name"], b, accent), 2.6)]
    for a in b["appearances"]:
        for m in (a.get("moments") or [])[:3]:
            cards.append((moment_card(m.get("frameUrl"), m, b["name"], a, accent), 2.8))
        if not a.get("moments") and a.get("thumbnail"):
            m = {"kind": "said" if "said" in a["signals"] else "on_screen", "t": a.get("timestamp") or 0, "text": a["evidence"], "highlights": []}
            cards.append((moment_card(a["thumbnail"], m, b["name"], a, accent), 2.8))
        if len(cards) >= 6:
            break
    cards.append((end_card(creator, b["name"], info, accent), 3.2))

    out_dir = os.path.join(ROOT, "public", "reels", handle)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{slug(b['name'])}.mp4")
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, (im, dur) in enumerate(cards):
            p = os.path.join(tmp, f"{i}.png")
            im.save(p)
            v = os.path.join(tmp, f"{i}.mp4")
            frames = int(dur * 30)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", p, "-t", str(dur),
                 "-vf", f"scale=1188:2112,zoompan=z='min(zoom+0.0009,1.06)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps=30,fade=t=in:st=0:d=0.25",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", v],
                check=True,
            )
            parts.append(v)
        lst = os.path.join(tmp, "list.txt")
        open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], check=True)
    print(out)


if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2])
