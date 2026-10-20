# Updating NGL competitions from Elevien (floor music)

Triggered when Dave asks Claude: "Update the NGL competitions from Elevien".

1. Sign in to the Elevien connector with `authenticate_sso` (Dave opens the link; read-only scope). Never ask for a password.
2. `list_my_tournaments` (limit 50, all pages). Keep tournaments with a non-empty `userRoles` (Dave's own).
3. For each: `get_tournament` -> index entry {tournamentId, title, startDate, startTime, disciplines[{name, programs[{programId, name, events[{eventId, name}]}]}]}.
4. For every WAG event of an upcoming tournament: `list_contestant_slots(eventId)`.
   Large results are saved to tool-results files: put the path in the index as `events[].file`.
   Small results: save the Floor (W) track only to EVENT_DIR/<eventId>.json as
   {"body":{"apparatusTracks":[{"apparatusName":"Floor (W)","contestantSlots":[{"contestantId","displayName","clubName"}]}]}}.
5. `python3 tools/elevien_music_import.py INDEX.json EVENT_DIR --out ngl-music-comps.js`
   It prints each competition with new/withdrawn counts. Commit and push ngl-music-comps.js.
6. Tell Dave what changed and to click "Load latest" (Update from Elevien) on the Floor music page, then Publish on the Clubs tab for competitions open for uploads.

Keys are stable (gymnast = contestantId, club = BG number, competition = earliest tournament id; National Finals 2026 keeps
its hand-made keys via KEEP in the script), so rotations, absences and uploads carry over between updates.
