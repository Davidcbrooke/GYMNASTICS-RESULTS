#!/usr/bin/env python3
"""
Build ngl-music-comps.js (all NGL competitions with floor music) from Elevien data.

Run by Claude after pulling from the Elevien connector:
  python3 tools/elevien_music_import.py INDEX.json EVENT_DIR [--out ngl-music-comps.js]

INDEX.json   list of the user's tournaments: tournamentId, title, startDate, startTime,
             disciplines[].programs[].events[] (eventId, name) - see get_tournament.
EVENT_DIR    one file per event with the raw list_contestant_slots response: <eventId>.json
             (or a mapping in INDEX: events[].file pointing at the saved tool result).

Rules
- Only WAG events with a "Floor (W)" apparatus track need music; gymnasts are taken in
  Elevien's Floor (W) order.
- Tournaments on the same date become ONE competition; each tournament is a session
  (ordered by start time). Each program+event is a level.
- Keys are stable between runs (gymnast = Elevien contestantId, club = BG number,
  competition = earliest tournament id), so rotations, absences and uploads carry over.
- KEEP keeps the established keys/labels of competitions that existed before this importer.
"""
import json, re, sys, os, datetime, unicodedata

KEEP = {
  # National Finals 2026 was set up by hand before the importer; keep its keys and labels.
  "8230,8231": {"compKey": "finals2026", "title": "NGL National Finals 2026",
                "sessions": {"8231": "Morning (Level A competition)", "8230": "Afternoon (Levels B and C competition)"},
                "levelIds": {"LEVEL A": "A", "LEVEL B": "B", "LEVEL C": "C"},
                "levelNames": {"LEVEL A": "Level A", "LEVEL B": "Level B", "LEVEL C": "Level C"}},
}

def load_js_obj(path, var):
    if not os.path.exists(path): return None
    s = open(path, encoding="utf-8").read()
    i = s.find("{", s.find(var)); return json.loads(s[i:s.rindex("}")+1])

def old_finals_clubs(repo):
    """club keys used by the hand-made Finals data (react, saadi, ...) by BG number"""
    p = os.path.join(repo, "ngl-music-data.js")
    if not os.path.exists(p): return {}
    out = {}
    for k, bg in re.findall(r'(\w+):\s*\{name:"[^"]*",\s*bg:"([^"]*)"\}', open(p, encoding="utf-8").read()):
        out[bg] = k
    return out

def club_split(club_name):
    """'Club A (123)' -> ('Club A','123'). Joint entries 'Club A (123),Club B (456)' -> the first club."""
    pairs = re.findall(r"\s*([^,()][^()]*?)\s*\(([^()]*)\)", club_name or "")
    if pairs: return pairs[0][0].strip(" ,"), pairs[0][1].strip()
    return (club_name or "").strip(), ""

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)[:24] or "club"

def title_case(s):
    small = {"and", "of", "the", "&"}
    return " ".join(w if w.isupper() and len(w) <= 4 and w not in ("LEVEL",) and not w.isalpha() else
                    (w.lower() if w.lower() in small else w.capitalize()) for w in s.split())

def common_title(titles):
    if len(titles) == 1: return re.sub(r",?\s*OPEN TO ALL REGIONS\s*$", "", titles[0].strip(), flags=re.I)
    pre = os.path.commonprefix(titles)
    pre = re.sub(r"[\s,\-|]+$", "", pre[:pre.rfind(",")] if "," in pre else pre)
    return pre.strip() or titles[0].strip()

def session_label(t, others, idx, n):
    when = ["Morning", "Afternoon", "Evening"][idx] if n > 1 and idx < 3 else "Competition"
    rest = t["title"]
    if n > 1:
        pre = os.path.commonprefix([o["title"] for o in others])
        rest = t["title"][len(pre[:pre.rfind(",")+1] if "," in pre else pre):].strip(" ,-|")
        rest = re.sub(r",?\s*OPEN TO ALL REGIONS\s*$", "", rest, flags=re.I).strip(" ,")
    return f"{when} ({rest})" if rest and n > 1 else when

def deadline_for(date):
    d = datetime.date.fromisoformat(date) - datetime.timedelta(days=21)
    while d.weekday() != 4: d -= datetime.timedelta(days=1)          # the Friday 3+ weeks before
    return d.strftime("%A ") + str(d.day) + d.strftime(" %B %Y")

def read_slots(ev, event_dir):
    for p in [os.path.join(event_dir, f"{ev['eventId']}.json"), ev.get("file") or ""]:
        if p and os.path.exists(p):
            s = open(p, encoding="utf-8").read().strip()
            if s.startswith("["):                       # saved tool result: [{"type":"text","text":"{...}"}]
                s = "".join(x.get("text", "") for x in json.loads(s) if isinstance(x, dict))
            i = s.find("{"); d = json.loads(s[i:]); return d.get("body", d)
    return None

def main():
    idx_path, event_dir = sys.argv[1], sys.argv[2]
    out = sys.argv[sys.argv.index("--out")+1] if "--out" in sys.argv else "ngl-music-comps.js"
    repo = os.path.dirname(os.path.abspath(out))
    index = json.load(open(idx_path, encoding="utf-8"))
    prev = load_js_obj(out, "NGL_MUSIC_COMPS") or {"comps": []}
    prev_by = {c["compKey"]: c for c in prev["comps"]}
    finals_keys = old_finals_clubs(repo)

    today = datetime.date.today().isoformat()
    def base(t):
        b = re.sub(r"\s*\|\s*LEVEL.*$", "", t["title"].split(",")[0], flags=re.I)
        return re.sub(r"\s+", " ", b).strip().upper()
    by_date = {}
    for t in index:
        if t["startDate"] < today and "--all" not in sys.argv: continue      # past competitions aren't needed
        by_date.setdefault((t["startDate"], base(t)), []).append(t)
    comps, report, missing = [], [], []
    for (date, _b), ts in sorted(by_date.items()):
        ts.sort(key=lambda t: (t.get("startTime") or "", t["tournamentId"]))
        wag = [t for t in ts if any(d.get("name") == "WAG" for d in t["disciplines"])]
        if not wag: continue
        ids = ",".join(sorted(t["tournamentId"] for t in wag))
        keep = KEEP.get(ids, {})
        key = keep.get("compKey") or "el" + min(t["tournamentId"] for t in wag)
        old = prev_by.get(key, {})
        clubs, levels = {}, []
        for si, t in enumerate(wag):
            sess = keep.get("sessions", {}).get(t["tournamentId"]) or session_label(t, wag, si, len(wag))
            for d in t["disciplines"]:
                if d.get("name") != "WAG": continue
                for pr in d.get("programs") or []:
                    for ev in pr["events"]:
                        body = read_slots(ev, event_dir)
                        if body is None:
                            if ev.get("floorSlots", 1): missing.append(ev["eventId"])
                            continue
                        if not pr.get("name"): pr["name"] = "Level"
                        floor = next((a for a in body.get("apparatusTracks", []) if a["apparatusName"] == "Floor (W)"), None)
                        if not floor or not floor["contestantSlots"]: continue
                        multi = len(pr["events"]) > 1
                        lid = keep.get("levelIds", {}).get(pr["name"]) or ("e" + ev["eventId"])
                        lname = keep.get("levelNames", {}).get(pr["name"]) or (title_case(pr["name"]) + (f" · {title_case(ev['name'])}" if multi else ""))
                        gyms = []
                        for sl in floor["contestantSlots"]:
                            name, bg = club_split(sl.get("clubName", ""))
                            ck = finals_keys.get(bg) if keep else None
                            ck = ck or (("bg" + re.sub(r"[^A-Za-z0-9]", "", bg)) if bg else slug(name))
                            clubs.setdefault(ck, {"name": name, "bg": bg})
                            gyms.append([str(sl["contestantId"]), sl.get("displayName") or f"{sl.get('firstName','')} {sl.get('lastName','')}".strip(), ck])
                        levels.append({"id": lid, "name": lname, "session": sess, "eventId": ev["eventId"], "gymnasts": gyms})
        n = sum(len(L["gymnasts"]) for L in levels)
        comp = {"compKey": key, "title": keep.get("title") or common_title([t["title"] for t in wag]),
                "date": date, "deadline": old.get("deadline") or deadline_for(date), "floorRotations": old.get("floorRotations", 4),
                "elevien": [t["tournamentId"] for t in wag], "clubs": clubs, "levels": levels}
        if key == "finals2026": comp["deadline"] = old.get("deadline") or "Saturday 31 October 2026"
        comps.append(comp)
        oldids = {g[0] for L in old.get("levels", []) for g in L["gymnasts"]}
        newids = {g[0] for L in levels for g in L["gymnasts"]}
        report.append(f"{date}  {comp['title']}  [{key}]  {n} gymnasts, {len(clubs)} clubs" +
                      (f"  (+{len(newids-oldids)} new, -{len(oldids-newids)} withdrawn)" if old else "  (NEW)"))
    data = {"updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "comps": comps}
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* NGL floor music: competitions and entries pulled from Elevien.\n"
                "   Generated by tools/elevien_music_import.py - do not edit by hand; ask Claude to update from Elevien.\n"
                "   Gymnast = [Elevien contestantId, name, club key], in Elevien's Floor (W) order. */\n")
        f.write("window.NGL_MUSIC_COMPS = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    print("\n".join(report))
    if missing: print("MISSING event data for:", ", ".join(missing))

if __name__ == "__main__":
    main()
