"""Assemble the Owed demo video: GMI voiceover, kinetic captions, recording cuts, before/after opener."""
import json, os, re, subprocess, sys, time, io
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = sys.argv[1]  # scratch dir holding the recording
REC = os.path.join(WORK, "rec.webm")
OUT = os.path.join(ROOT, "demo", "owed-demo.mp4")
W, H, FPS = 1920, 1080, 30
LIME, BG, INK = (200, 241, 105), (11, 11, 12), (242, 240, 234)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
KEY = [l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env.local")) if l.startswith("LLM_API_KEY=")][0]
os.makedirs(os.path.join(WORK, "seg"), exist_ok=True)

def font(s, bold=True):
    return ImageFont.truetype(FONT, s, index=1 if bold else 0)

def sh(*a):
    subprocess.run(a, check=True)

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).strip())

# (voiceover, visual) — visual: ("rec", a, b) | ("reel",) | ("before",) | ("card", title, sub)
SCRIPT = [
    ("This is a get-ready-with-me video. Two point six million views. Mid-video, Mikayla says the word Maybelline.", ("before",)),
    ("Maybelline paid her nothing. Owed turns that moment into this.", ("split",)),
    ("Owed. Get paid for the brands you already promote.", ("card", "Owed.", "Get paid for the brands you already promote.")),
    ("Creators promote brands for free every single day. Since July, almost four thousand videos literally say, this is not sponsored.", ("rec", 5.4, 9.3)),
    ("Type a handle, and Owed watches the last forty videos the way a brand would. Every word, every frame, every line of on-screen text.", ("rec", 9.0, 11.4)),
    ("Mikayla gave away seven hundred and ten thousand dollars of free promotion, to eighteen brands.", ("rec", 11.4, 15.8)),
    ("Seventy-one percent of it was never tagged, so the brands can't even see it. And four of them are paying other creators right now.", ("rec", 16.7, 21.4)),
    ("Maybelline ran over twelve hundred sponsored posts in ninety days. Just not with her.", ("rec", 22.4, 26.3)),
    ("Click any mention, and the video plays right here, with the exact moment she said it.", ("rec", 26.6, 39.0)),
    ("On-screen mentions get boxed, frame by frame, straight from Oriane's video index.", ("rec", 46.3, 60.0)),
    ("Then Owed cuts a sponsor reel, in the brand's own colors, ending with her reach and her manager's email.", ("reel",)),
    ("One click writes the pitch. Real numbers, the real quote, and a link to her proof page.", ("rec", 89.8, 96.6)),
    ("And this is what the brand opens. A media kit built from proof, not promises.", ("rec", 116.6, 132.0)),
    ("Owed. Built on Oriane, GMI Cloud and Lovable. Every creator is owed something. Now they can prove it.", ("card", "Owed.", "owed-app.lovable.app")),
]

# ---------- voiceover via GMI MiniMax ----------
def tts(i, text):
    out = os.path.join(WORK, "seg", f"vo{i}.mp3")
    if os.path.exists(out):
        return out
    h = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    r = requests.post("https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests", headers=h, json={
        "model": "minimax-tts-speech-2.8-hd",
        "payload": {"text": text, "voice_id": "English_expressive_narrator", "speed": "1.08", "format": "mp3",
                    "audio_sample_rate": "44100", "channel": "1", "emotion": "auto"}}).json()
    rid = r["request_id"]
    for _ in range(120):
        s = requests.get(f"https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests/{rid}", headers=h).json()
        if s.get("status") == "success":
            oc = s.get("outcome") or {}
            url = next((v for v in json.dumps(oc).split('"') if v.startswith("http") and (".mp3" in v or "audio" in v)), None)
            if not url:
                raise RuntimeError(f"no audio url: {oc}")
            open(out, "wb").write(requests.get(url).content)
            return out
        if s.get("status") in ("failed", "error"):
            raise RuntimeError(str(s)[:300])
        time.sleep(2)
    raise TimeoutError(text)

# ---------- caption chunks ----------
HOT = re.compile(r"(\$?[0-9][\d,.]*%?|seven hundred and ten thousand dollars|seventy-one percent|two point six million|forty|eighteen|twelve hundred|ninety|four thousand|Maybelline|Owed\.?|Oriane'?s?|GMI Cloud|Lovable|Mikayla|nothing|not sponsored|never tagged|proof)", re.I)

def chunks(text, n=4):
    words = text.split()
    out, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= n or w.endswith((".", ",", "?")):
            out.append(" ".join(cur)); cur = []
    if cur:
        out.append(" ".join(cur))
    return out

def caption_png(text, path):
    im = Image.new("RGBA", (W, 220), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(66)
    # split into hot / normal spans
    parts, last = [], 0
    for m in HOT.finditer(text):
        if m.start() > last: parts.append((text[last:m.start()], INK))
        parts.append((m.group(0), LIME)); last = m.end()
    if last < len(text): parts.append((text[last:], INK))
    total = sum(d.textlength(t, font=f) for t, _ in parts)
    x = (W - total) / 2
    pad = 28
    d.rounded_rectangle((x - pad, 50, x + total + pad, 170), radius=26, fill=(11, 11, 12, 215))
    for t, c in parts:
        d.text((x, 110), t, font=f, fill=c, anchor="lm")
        x += d.textlength(t, font=f)
    im.save(path)

# ---------- visuals ----------
def fetch(url):
    try:
        return Image.open(io.BytesIO(requests.get(url, timeout=20).content)).convert("RGB")
    except Exception:
        return None

def card_png(title, sub, path):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((W / 2, H / 2 - 60), title, font=font(220), fill=INK, anchor="mm")
    d.text((W / 2, H / 2 + 110), sub, font=font(54, False), fill=LIME, anchor="mm")
    im.save(path)

def before_frames():
    data = json.load(open(os.path.join(ROOT, ".cache", "mikaylanogueira.json")))
    b = next(x for x in data["brands"] if x["name"] == "Maybelline")
    a = b["appearances"][0]
    urls = [m["frameUrl"] for m in a.get("moments", []) if m.get("frameUrl")]
    urls = ([a["thumbnail"]] if a.get("thumbnail") else []) + urls
    imgs = [i for i in (fetch(u) for u in urls) if i]
    return imgs, a

def vertical_on_blur(img, label=None, sub=None):
    bg = img.resize((W, int(W * img.height / img.width))).crop((0, 0, W, H)) if img.width / img.height > W / H else img.resize((int(H * img.width / img.height * 1.0), H))
    bg = Image.new("RGB", (W, H), BG)
    blur = img.copy().resize((W, int(W * img.height / img.width))).filter(ImageFilter.GaussianBlur(40))
    bg.paste(blur, (0, (H - blur.height) // 2))
    bg = Image.blend(bg, Image.new("RGB", (W, H), BG), 0.55)
    fh = 960; fw = int(fh * img.width / img.height)
    bg.paste(img.resize((fw, fh)), ((W - fw) // 2, 60))
    d = ImageDraw.Draw(bg)
    if label:
        d.rounded_rectangle((60, 60, 60 + d.textlength(label, font=font(44)) + 50, 130), radius=35, fill=INK)
        d.text((85, 95), label, font=font(44), fill=BG, anchor="lm")
    if sub:
        d.text((60, 175), sub, font=font(40, False), fill=INK, anchor="lm")
    return bg

def make_segment(i, vo, visual):
    seg = os.path.join(WORK, "seg", f"s{i}.mp4")
    D = dur(vo) + 0.35
    kind = visual[0]
    vf_fit = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0b0c,setsar=1,fps={FPS}"
    if kind == "rec":
        a, b = visual[1], visual[2]
        span = b - a
        speed = max(min(span / D, 2.5), 0.6)
        # slight push-in for motion
        sh("ffmpeg", "-y", "-loglevel", "error", "-ss", str(a), "-t", str(span), "-i", REC,
           "-vf", f"setpts=PTS/{speed},scale=1440*1.18:900*1.18,crop=1440*1.1:900*1.1,{vf_fit},tpad=stop_mode=clone:stop_duration={D}",
           "-t", str(D), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS), seg)
    elif kind == "reel":
        reel = os.path.join(ROOT, "public", "reels", "mikaylanogueira", "maybelline.mp4")
        sh("ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "1", "-i", reel,
           "-filter_complex", f"[0:v]split[a][b];[a]scale={W}:-2,crop={W}:{H},gblur=sigma=40,eq=brightness=-0.25[bg];[b]scale=-2:1000[fg];[bg][fg]overlay=(W-w)/2:40,setsar=1,fps={FPS}",
           "-t", str(D), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", seg)
    elif kind == "card":
        png = os.path.join(WORK, "seg", f"card{i}.png"); card_png(visual[1], visual[2], png)
        sh("ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", str(D),
           "-vf", f"scale=2112:1188,zoompan=z='min(zoom+0.0007,1.05)':d={int(D*FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", seg)
    elif kind == "before":
        imgs, a = before_frames()
        cut = D / max(len(imgs[:5]), 1)
        parts = []
        for k, im in enumerate(imgs[:5]):
            p = os.path.join(WORK, "seg", f"b{i}_{k}.png")
            vertical_on_blur(im, "BEFORE", f"@mikaylanogueira · {a['views']/1e6:.1f}M views · $0 from Maybelline").save(p)
            v = p.replace(".png", ".mp4")
            sh("ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", p, "-t", str(cut),
               "-vf", f"scale=2112:1188,zoompan=z='1.04+0.03*on/{int(cut*FPS)}':d={int(cut*FPS)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", v)
            parts.append(v)
        lst = seg + ".txt"; open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
        sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", seg)
    elif kind == "split":
        imgs, a = before_frames()
        left = os.path.join(WORK, "seg", f"left{i}.png")
        im = imgs[min(1, len(imgs) - 1)]
        canvas = Image.new("RGB", (W // 2, H), BG)
        fh = 900; fw = int(fh * im.width / im.height)
        canvas.paste(im.resize((fw, fh)), ((W // 2 - fw) // 2, 120))
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((40, 30, 290, 95), radius=32, fill=INK); d.text((165, 62), "BEFORE", font=font(40), fill=BG, anchor="mm")
        canvas.save(left)
        reel = os.path.join(ROOT, "public", "reels", "mikaylanogueira", "maybelline.mp4")
        lab = os.path.join(WORK, "seg", "after.png")
        li = Image.new("RGBA", (300, 90), (0, 0, 0, 0)); ld = ImageDraw.Draw(li)
        ld.rounded_rectangle((0, 0, 250, 65), radius=32, fill=LIME); ld.text((125, 32), "AFTER", font=font(40), fill=BG, anchor="mm"); li.save(lab)
        sh("ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", left, "-i", reel, "-i", lab,
           "-filter_complex", f"[1:v]scale=-2:900,pad={W//2}:{H}:(ow-iw)/2:120:color=0x0b0b0c[r];[0:v][r]hstack=inputs=2[s];[s][2:v]overlay={W//2+40}:30,setsar=1,fps={FPS}",
           "-t", str(D), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", seg)
    # captions burned on top, chunked across the voiceover
    cs = chunks(SCRIPT[i][0])
    total_words = sum(len(c.split()) for c in cs)
    t, inputs, filt, last = 0.15, [], "", "[0:v]"
    vod = dur(vo)
    for k, c in enumerate(cs):
        p = os.path.join(WORK, "seg", f"c{i}_{k}.png"); caption_png(c, p); inputs += ["-i", p]
        dt = vod * len(c.split()) / total_words
        nxt = f"[v{k}]"
        filt += f"{last}[{k+1}:v]overlay=0:{H-250}:enable='between(t,{t:.2f},{t+dt:.2f})'{nxt};"
        last, t = nxt, t + dt
    capped = seg.replace(".mp4", "_c.mp4")
    sh("ffmpeg", "-y", "-loglevel", "error", "-i", seg, *inputs, "-i", vo, "-filter_complex", filt.rstrip(";"),
       "-map", last, "-map", f"{len(cs)+1}:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "2",
       "-af", "apad", "-t", str(D), capped)
    return capped

if __name__ == "__main__":
    with ThreadPoolExecutor(6) as ex:
        vos = list(ex.map(lambda x: tts(*x), enumerate(s for s, _ in SCRIPT)))
    print("voiceover done", sum(dur(v) for v in vos))
    with ThreadPoolExecutor(4) as ex:
        segs = list(ex.map(lambda x: make_segment(x[0], vos[x[0]], x[1][1]), enumerate(SCRIPT)))
    lst = os.path.join(WORK, "seg", "all.txt"); open(lst, "w").write("".join(f"file '{s}'\n" for s in segs))
    sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", OUT)
    print(OUT, dur(OUT))
