"""Assembles the demo video.

  python compose.py prep     # recordings (frames) -> 25 fps mp4 + marks in seconds
  python compose.py build    # scenes -> clips, captions, narration -> final.mp4

Scenes are in scenes.json: each has the narration id and its picture, either
  {"still": "stills/x.png", "pan": [y0, y1]}     a still, optionally panned
  {"rec": "01-linelist", "from": "label", "to": "label", "zoom": [x,y,w,h]}
  or a list of such parts. A part's length is fitted to the narration: sped
up (to at most MAX_SPEED) when longer, held on its last frame when shorter.
"""
import json, os, subprocess, sys, wave
import numpy as np

FPS = 25
W, H = 1920, 1080
LEAD, TAIL = 0.5, 0.7          # silence before / after each scene's speech
MAX_SPEED = 4.0
REC = "rec/out"
BUILD = "build"
os.makedirs(BUILD, exist_ok=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(cmd)[:400]); print(r.stderr[-2000:]); sys.exit(1)
    return r.stdout


def prep():
    for name in sorted(f[:-12] for f in os.listdir(REC) if f.endswith(".frames.json")):
        frames = json.load(open(f"{REC}/{name}.frames.json"))
        if not frames:
            continue
        t0 = frames[0]["ts"]
        lst = f"{BUILD}/{name}.concat.txt"
        with open(lst, "w") as f:
            for a, b in zip(frames, frames[1:] + [None]):
                d = max((b["ts"] - a["ts"]) if b else 1.0, 0.001)
                # A long still stretch is written as repeated 2 s holds: the
                # same timing, without one huge frame duration.
                while d > 2.0:
                    f.write(f"file '../{REC}/{name}/{a['file']}'\nduration 2.0000\n")
                    d -= 2.0
                f.write(f"file '../{REC}/{name}/{a['file']}'\nduration {d:.4f}\n")
            f.write(f"file '../{REC}/{name}/{frames[-1]['file']}'\n")
        out = f"{BUILD}/{name}.mp4"
        if not os.path.exists(out):
            run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                 "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-threads", "2", out])
        marks = json.load(open(f"{REC}/{name}.marks.json"))
        m = {x["label"]: round(x["epoch"] - t0, 2) for x in marks}
        m["_end"] = round(frames[-1]["ts"] - t0 + 1.0, 2)
        json.dump(m, open(f"{BUILD}/{name}.marks.json", "w"), indent=1)
        print(f"{name}: {m['_end']:.0f} s, {len(frames)} frames")


def dur_of(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def part_clip(part, idx, out):
    """One picture part as an mp4 of its natural length; returns that length."""
    if "still" in part:
        secs = part.get("secs", 6.0)
        if "crop" in part:
            # A 16:9 window, moved linearly from crop to crop_to over the part.
            x0, y0, cw, ch = part["crop"]
            x1, y1 = (part.get("crop_to") or part["crop"])[:2]
            vf = (f"crop={cw}:{ch}:'{x0}+({x1}-{x0})*t/{secs}':'{y0}+({y1}-{y0})*t/{secs}',"
                  f"scale={W}:{H}:flags=lanczos,format=yuv420p")
        else:
            vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p"
        run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", part["still"], "-t", f"{secs}",
             "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-threads", "2", out])
        return secs
    marks = json.load(open(f"{BUILD}/{part['rec']}.marks.json"))
    a = marks[part["from"]] + part.get("from_off", 0)
    b = marks[part.get("to", "_end")] + part.get("to_off", 0)
    vf = []
    if "zoom" in part:
        x, y, w, h = part["zoom"]
        vf.append(f"crop={w}:{h}:{x}:{y},scale={W}:{H}:flags=lanczos")
    vf.append("format=yuv420p")
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", f"{BUILD}/{part['rec']}.mp4",
         "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-threads", "2", out])
    return b - a


def fit(src, natural, target, out, fade_in, fade_out):
    """Speeds a clip up or holds its last frame so it lasts exactly target s."""
    speed = max(1.0, min(MAX_SPEED, natural / target)) if natural > target else 1.0
    after = natural / speed
    vf = [f"setpts=PTS/{speed:.4f}"] if speed > 1.0 else []
    if after < target:
        vf.append(f"tpad=stop_mode=clone:stop_duration={target - after + 0.1:.2f}")
    vf.append(f"trim=duration={target:.3f}")
    if fade_in:
        vf.append(f"fade=t=in:st=0:d=0.3")
    if fade_out:
        vf.append(f"fade=t=out:st={target - 0.3:.3f}:d=0.3")
    vf.append(f"fps={FPS},format=yuv420p")
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", ",".join(vf), "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-threads", "2", out])
    if speed > 1.0:
        print(f"    sped up x{speed:.2f}" + ("  (still too long: trimmed)" if natural / speed > target + 0.05 else ""))


DISPLAY = [("Pharm Tech", "Pharm. Tech"), ("A E F I", "AEFI"), ("E2B R3", "E2B(R3)"), ("C 1 7", "C.1.7"),
           ("Persistent cries becomes Crying", "“Persistent cries” becomes “Crying”"),
           ("Still on admission", "“Still on admission”")]


def with_punctuation(words, text):
    """Edge's word timings carry bare words; take each word's spelling,
    with its punctuation, from the script itself (same order)."""
    import re
    tokens = text.split()
    norm = lambda x: re.sub(r"[^a-z0-9]", "", x.lower())
    out, k = [], 0
    for w in words:
        target = norm(w["w"])
        j = k
        while j < len(tokens) and norm(tokens[j]) != target and not (target and norm(tokens[j]).startswith(target)):
            j += 1
        if j < len(tokens):
            out.append({**w, "w": tokens[j]}); k = j + 1
        else:
            out.append(w)
    return out


def caption_lines(words, text, max_chars=60):
    words = with_punctuation(words, text)
    lines, cur = [], []
    for w in words:
        cur.append(w)
        line = " ".join(x["w"] for x in cur)
        end_punct = w["w"][-1:] in ".,:;?!"
        if (end_punct and (len(line) > 24 or w["w"][-1:] in ".?!:;")) or len(line) > max_chars:
            lines.append(cur); cur = []
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        line = " ".join(x["w"] for x in ln)
        for a, b in DISPLAY:
            line = line.replace(a, b)
        out.append((ln[0]["t"], ln[-1]["t"] + ln[-1]["d"], line))
    return out


def ass_time(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def build():
    scenes = json.load(open("scenes.json", encoding="utf-8"))
    texts = {n["id"]: n["text"] for n in json.load(open("narration.json", encoding="utf-8"))}
    sr = 48000
    track = []
    clips = []
    subs = []
    t = 0.0
    prev_src = None
    for i, sc in enumerate(scenes):
        meta = json.load(open(f"voice/{sc['id']}.json"))
        D = LEAD + meta["duration"] + TAIL + sc.get("extra", 0)
        parts = sc["picture"] if isinstance(sc["picture"], list) else [sc["picture"]]
        print(f"{sc['id']}: {D:.1f} s, {len(parts)} part(s)")
        # Share the scene's time among its parts in proportion to their length.
        nat = []
        for k, part in enumerate(parts):
            raw = f"{BUILD}/{sc['id']}-{k}-raw.mp4"
            nat.append(part_clip(part, k, raw))
        weights = [p.get("weight", n) for p, n in zip(parts, nat)]
        src_key = parts[0].get("rec") or parts[0].get("still")
        for k, part in enumerate(parts):
            share = D * weights[k] / sum(weights)
            out = f"{BUILD}/{sc['id']}-{k}.mp4"
            first_src = part.get("rec") or part.get("still")
            fade_in = (k == 0 and (i == 0 or sc.get("fade", src_key != prev_src)))
            nxt = scenes[i + 1] if i + 1 < len(scenes) else None
            nxt_parts = (nxt["picture"] if isinstance(nxt["picture"], list) else [nxt["picture"]]) if nxt else None
            nxt_src = (nxt_parts[0].get("rec") or nxt_parts[0].get("still")) if nxt else None
            last_src = parts[-1].get("rec") or parts[-1].get("still")
            fade_out = k == len(parts) - 1 and (nxt is None or nxt.get("fade", nxt_src != last_src))
            fit(f"{BUILD}/{sc['id']}-{k}-raw.mp4", nat[k], share, out, fade_in, fade_out)
            clips.append(out)
        prev_src = parts[-1].get("rec") or parts[-1].get("still")
        # Narration and captions.
        w = wave.open(f"voice/{sc['id']}.wav", "rb")
        speech = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2)
        start = int((t + LEAD) * sr)
        track.append((start, speech))
        for a, b, text in caption_lines(meta["words"], texts[sc["id"]]):
            subs.append((t + LEAD + a, t + LEAD + b + 0.25, text))
        t += D
    total = t
    audio = np.zeros((int(total * sr) + sr, 2), dtype=np.int32)
    for start, speech in track:
        audio[start:start + len(speech)] += speech
    audio = np.clip(audio, -32768, 32767).astype(np.int16)
    with wave.open(f"{BUILD}/narration.wav", "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(audio.tobytes())
    with open(f"{BUILD}/clips.txt", "w") as f:
        for c in clips:
            f.write(f"file '{os.path.basename(c)}'\n")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{BUILD}/clips.txt", "-c", "copy", f"{BUILD}/picture.mp4"])
    # Captions: white text on a dark box, low centre, as in the original.
    with open(f"{BUILD}/captions.ass", "w", encoding="utf-8") as f:
        f.write("[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\n"
                "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
                "Style: Cap,Segoe UI Semibold,44,&H00FFFFFF,&H00FFFFFF,&H38202020,&H38202020,0,0,0,0,100,100,0,0,3,14,0,2,160,160,64,1\n\n"
                "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
        for k, (a, b, text) in enumerate(subs):
            if k + 1 < len(subs):
                b = min(b, subs[k + 1][0] - 0.02)   # never two captions at once
            f.write(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Cap,,0,0,0,,{text}\n")
    burn()



def burn():
    final = "PV-Assist-demo-live-system.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-i", f"{BUILD}/picture.mp4", "-i", f"{BUILD}/narration.wav",
         "-vf", "subtitles=build/captions.ass:fontsdir=C\\\\:/Windows/Fonts", "-c:v", "libx264", "-preset", "medium",
         "-crf", "19", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest",
         "-movflags", "+faststart", final])
    print(f"{final}: {dur_of(final):.1f} s")


if __name__ == "__main__":
    {"prep": prep, "build": build, "burn": burn}[sys.argv[1]]()
