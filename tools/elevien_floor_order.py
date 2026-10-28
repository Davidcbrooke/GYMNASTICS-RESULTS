#!/usr/bin/env python3
"""
Put Elevien's competition floor schedule into ngl-music-comps.js, so the floor music
player sorts itself into programme order (no file to upload).

Run by Claude after reading each session's schedule page in Elevien
(app.elevien.com/admin/<tournamentId>/schedule, page text):
  python3 tools/elevien_floor_order.py ngl-music-comps.js <compKey> <tournamentId>=<schedule.txt> [...]

Schedule page text: the apparatus headers with their group sizes (in programme order),
then every gymnast as "<n> <First Last>" in that same order, group after group.

Floor order for every rotation: groups move one piece per rotation; on each piece after
the first the first gymnast moves to the back, and breaks don't count. This matches
Elevien's "Generate rotations" (checked against the full rotations of National Finals 2026).

Writes comp.floorOrder[<session label>] = {"at": <time>, "rotations": [[contestantId, ...], ...]}.
The player applies it automatically the first time it sees a new "at" for a session.
elevien_music_import.py keeps floorOrder when it re-imports the entries.
"""
import json, re, sys, datetime, unicodedata

APP = re.compile(r"^(Vault|Uneven Bars|Balance Beam|Floor|Break|Pommel Horse|Rings|Parallel Bars|High Bar)\b", re.I)

def words(n):
    n = unicodedata.normalize("NFD", n.lower())
    return sorted(w for w in (re.sub(r"[^a-z]", "", x) for x in n.split()) if w)

def read_schedule(path):
    lines = [l.strip() for l in open(path, encoding="utf-8")]
    stations, names, i = [], [], 0
    while i < len(lines):
        l = lines[i]
        if APP.match(l) and i + 1 < len(lines) and re.fullmatch(r"\d+", lines[i+1]) and not names:
            stations.append({"app": l, "n": int(lines[i+1]), "brk": l.lower().startswith("break")}); i += 2; continue
        m = re.fullmatch(r"(\d+)\s+(.+)", l)
        if m and stations and not re.match(r"\d+/\d+/\d+", l): names.append(m.group(2))
        i += 1
    if sum(s["n"] for s in stations) != len(names):
        raise SystemExit(f"{path}: the groups add up to {sum(s['n'] for s in stations)} but {len(names)} gymnasts were listed")
    k = 0
    for s in stations: s["names"] = names[k:k+s["n"]]; k += s["n"]
    return stations

def floor_rotations(st):
    n = len(st); f = next((i for i, s in enumerate(st) if s["app"].lower().startswith("floor")), None)
    if f is None: raise SystemExit("No Floor in this schedule")
    out = []
    for r in range(n):
        s = (f - r) % n; g = st[s]["names"]
        if not g: out.append([]); continue
        k = sum(1 for j in range(r) if not st[(s + j) % n]["brk"]) % len(g)
        out.append(g[k:] + g[:k])
    return out

def main():
    path, key, pairs = sys.argv[1], sys.argv[2], sys.argv[3:]
    src = open(path, encoding="utf-8").read()
    head, body = src.split("window.NGL_MUSIC_COMPS = ", 1)
    data = json.loads(body.rstrip().rstrip(";"))
    comp = next(c for c in data["comps"] if c["compKey"] == key)
    at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    comp.setdefault("floorOrder", {})
    for p in pairs:
        tid, f = p.split("=", 1)
        rots = floor_rotations(read_schedule(f))
        # find the session whose gymnasts match these names best
        best = None
        for label in dict.fromkeys(L["session"] for L in comp["levels"]):
            pool = [(g[0], words(g[1])) for L in comp["levels"] if L["session"] == label for g in L["gymnasts"]]
            used, ids, miss = set(), [], []
            for r in rots:
                row = []
                for nm in r:
                    w = words(nm)
                    m = next((i for i, pw in pool if i not in used and pw == w), None) or \
                        next((i for i, pw in pool if i not in used and (set(pw) <= set(w) or set(w) <= set(pw))), None)
                    if m: used.add(m); row.append(m)
                    else: miss.append(nm)
                ids.append(row)
            hit = sum(map(len, ids))
            if not best or hit > best[1]:
                best = (label, hit, ids, miss, [g[1] for L in comp["levels"] if L["session"] == label for g in L["gymnasts"] if g[0] not in used])
        label, hit, ids, miss, notin = best
        comp["floorOrder"][label] = {"at": at, "tournamentId": tid, "rotations": ids}
        print(f"{tid} -> {label}: {len(ids)} floor rotations, {hit} placed " + " ".join(f"R{i+1}:{len(r)}" for i, r in enumerate(ids)))
        if miss: print("   in the schedule but not in the entries:", ", ".join(miss))
        if notin: print("   in the entries but not in the schedule:", ", ".join(notin))
    with open(path, "w", encoding="utf-8") as fo:
        fo.write(head + "window.NGL_MUSIC_COMPS = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")

if __name__ == "__main__":
    main()
