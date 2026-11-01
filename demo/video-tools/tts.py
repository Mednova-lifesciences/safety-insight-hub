"""Voices each scene of narration.json with the chosen voice and keeps the
word timings, so captions can follow the speech exactly.
   python tts.py [voice] [only-id]"""
import asyncio, json, os, subprocess, sys
import edge_tts

VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-US-SteffanNeural"
ONLY = sys.argv[2] if len(sys.argv) > 2 else None
OUT = "voice"
os.makedirs(OUT, exist_ok=True)


async def scene(s):
    words, audio = [], bytearray()
    com = edge_tts.Communicate(s["text"], VOICE, boundary="WordBoundary")
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "w": chunk["text"]})
    mp3 = f"{OUT}/{s['id']}.mp3"
    open(mp3, "wb").write(audio)
    wav = f"{OUT}/{s['id']}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ar", "48000", "-ac", "2", wav], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                               capture_output=True, text=True).stdout)
    json.dump({"id": s["id"], "duration": dur, "words": words}, open(f"{OUT}/{s['id']}.json", "w"), indent=1)
    print(f"{s['id']}: {dur:.1f} s, {len(words)} words")
    return dur


async def main():
    total = 0
    for s in json.load(open("narration.json", encoding="utf-8")):
        if ONLY and s["id"] != ONLY:
            continue
        total += await scene(s)
    print(f"total speech {total:.1f} s")

asyncio.run(main())
