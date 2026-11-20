---
name: orwell
description: ORWELL finds passive voice in writing and turns it active where that is clearer. Use it whenever you develop text output in this project, such as a daily summary JSON, README or other docs, page copy in templates, chart subtitles, commit messages, or a long chat answer. Also use it when the user asks to check writing for passive voice, or types /orwell. Pass a file path or paste the text.
---

# ORWELL: passive voice check

"Never use the passive where you can use the active." (George Orwell, *Politics and the English Language*, rule 4)

Passive voice hides who did what: "the tanker was struck" leaves out the attacker. Active voice names the actor first: "a missile struck the tanker". In a news summary, the actor is often the news.

## When to run it

- **Before you finish any text you wrote:** summaries, docs, page copy, messages. Check your draft and fix it before you show it or commit it.
- **When the user asks:** check the file or text they name and report what you find.

## Steps

1. **Find candidates.** Run the checker on the file, or pipe text to it:

   ```bash
   python3 .claude/skills/orwell/scripts/find_passive.py data/summaries/2026-11-17.json
   ```

   ```bash
   printf '%s\n' "The attack was thwarted." | python3 .claude/skills/orwell/scripts/find_passive.py -
   ```

   It reads every string in a `.json` file (skipping `url`, `date`, `generated_at`) and the whole text of any other file. Each hit shows where it is, the phrase, the agent if a "by ..." follows, and the sentence. It is a pattern match, so also read the text yourself: it misses passives with no "be" or "get" ("the ship, struck twice, sank") and flags some adjectives.

2. **Judge each hit.** Drop false positives first: adjectives that follow "be", such as "the port is closed", "the crew are unaccounted for" or "she is interested". The checker marks the common ones `maybe adjective`.

   Then decide whether each real passive should stay:

   | Rewrite to active | Keep passive |
   |---|---|
   | The sentence names the agent ("was struck **by a projectile**"). Move it to the front: "A projectile struck a tanker." | The actor is unknown and the sentence would need an invented subject: "Explosions were heard in Manama." |
   | Context tells you the actor ("CENTCOM said the attack was defeated" → "CENTCOM said it defeated the attack"). | The focus is on the thing acted on, and the actor does not matter: "No new JINSA total was found." |
   | The passive hides responsibility the reader needs ("mistakes were made"). | Naming an actor would claim more than the sources do. Never assign blame the source did not. |

3. **Rewrite.** Keep the meaning, the facts and the hedges exactly. Changing voice must not change whom the source says acted, how sure the source is ("claimed", "reported", "not independently confirmed"), or the attribution ("UKMTO said").

4. **Report.** List each hit as: location, original sentence, verdict (rewrite / keep / not passive), and the rewrite or a few words of reason. End with counts, e.g. "14 hits: 6 rewritten, 5 kept, 3 not passive".

## Project rules

- **Published daily summaries** (`data/summaries/*.json` already committed) must match the email word for word (README, "Design"). Report hits there; do not edit them unless the user asks.
- **New summaries and drafts:** apply the rewrites before committing.
- The build's text rules still apply to any rewrite: plain text, no HTML, no en or em dashes. Run `python3 build.py --check` after editing a summary.
