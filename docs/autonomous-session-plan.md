# Autonomous session plan

The project owner is stepping away for an extended period and asked for autonomous progress in
the meantime. This file is the guideline for that work. **Read this file in full:**

- Now, before doing anything else this turn.
- Immediately after any context compaction (a compacted-context summary is a trigger to re-read
  this file before continuing, not just a resume cue).
- Before starting any new roadmap item.

A memory entry (`feedback_autonomous_session_plan.md`, indexed in `MEMORY.md`) points back at this
file so the instruction to re-read it survives even if this file's own content falls out of
context.

## Task source

`docs/skill-system-roadmap.md` is the single source of truth for what to work on. Don't invent new
feature scope beyond what's written there -- if something looks missing or ambiguous, add a dated
note to the roadmap describing the gap rather than guessing silently and moving on.

Status snapshot as of 2026-10-15 (re-check the roadmap doc itself for the current state -- this
snapshot will go stale):

| # | Item | Status |
|---|------|--------|
| 1 | Skill cap system + priority list | Complete, fully verified 2026-10-15 |
| 2 | Zenith skills as a separate filter | Complete |
| 3 | Exotic skills | Resolved 2026-10-15 -- does not exist, no implementation needed |
| 4 | "Go Skill Boost" | Open point 2026-10-15 -- research inconclusive, needs owner input |
| 5 | Cleaner UI + better skill categorization | Reviewed 2026-10-15, deliberately left undecided (see roadmap) |
| 6 | Cuff equipment support | Complete (plus two follow-up correctness fixes) |
| 7 | Exclude/force-include specific pieces (armor picker) | Armor picker complete 2026-10-15; cuff picker deferred (open point) |
| 8 | Weapon Zenith-skill slot support | Complete, fully verified 2026-10-15 |

Work order: proceed through the "Not started" items in roadmap order unless one is clearly blocked,
in which case skip to the next and leave a note explaining why. Per the project owner's explicit
instruction (2026-10-15): prefer items with *more* existing research/context attached first, since
the thin ones need more from-scratch investigation -- re-check each item's section length/depth in
the roadmap doc before picking the next one, don't just go in numeric order blindly.

For every item: implement, then verify (tests, lint, typecheck, and a live browser check for
anything UI-visible -- see this project's own established convention of checking one layer at a
time before moving to the next), then update that item's roadmap section with what changed and
what was verified, before starting the next one.

## Permission-dialog avoidance

Researched directly against the official Claude Code docs (code.claude.com/docs, 2026-10-15).
**"Bypass permissions" mode does not skip every prompt.** What still gates action regardless of
permission mode:

- `rm`/`rmdir` targeting a "critical path": the filesystem root, the home directory, a drive root,
  a top-level directory, the working directory itself, or any parent of the working directory.
  This is a hard circuit breaker -- no allow rule or hook can approve it, and it's denied outright
  if left unanswered too long.
- PowerShell `Remove-Item` (and cmd `rd`/`del`/`erase`) targeting a system path, a bare `*`, or any
  path ending in `/*` -- denied outright in every mode, bypass included.
- Any explicit `ask` rule in `.claude/settings.json`/`settings.local.json` (checked this repo's
  `settings.local.json`: no `ask` rules present today, so a git prompt this session most likely
  traces back to built-in caution around destructive/hard-to-reverse actions rather than the app's
  own permission system -- see the next section).
- MCP tools marked `requiresUserInteraction`, org-configured "ask" connector tools, and
  `AskUserQuestion` itself.
- The sandbox's unsandboxed-retry escape hatch (`dangerouslyDisableSandbox`) -- moot here, since the
  sandbox doesn't run on native Windows at all.

**Guidelines for this session:**

1. Never delete anything via a broad, glob, or ambiguous path -- no bare `*`, no trailing `/*`, no
   top-level directory, never the project root or home directory, never a parent of the working
   directory. Always name one specific file by its precise relative path.
2. Prefer moving a file aside (`mv file file.bak-<reason>`) over deleting it outright -- already
   this project's established convention for DB rebuilds (see `project_cuff_equipment_support.md`),
   and it sidesteps the `rm` circuit breaker as a side effect. Only delete files created this
   session as scratch/intermediate output, and only by their exact relative path, never in bulk.
3. For git, stick to the always-safe subset: `git status`, `git diff`, `git log`, `git add <files>`,
   `git commit` (new commits only, never `--amend`), `git branch` (create only, never `-D`). Never
   run `git push --force`, `git reset --hard`, `git clean`, `git checkout --`/`git restore`
   (discarding changes), `git stash drop`/`clear`, or touch remotes (`remote set-url`/`add`). This
   list is exactly the set of git operations that are both genuinely risky and the ones most likely
   to prompt -- avoiding them serves both goals at once.
4. Don't commit automatically just because autonomy was granted -- the project's own standing rule
   (never commit unless explicitly asked) still applies; track completed work in the roadmap doc
   instead and let the owner decide when to commit.
5. If a push to a remote is ever needed, a plain (non-force) push only; if it would require force or
   gets rejected, stop and leave a clear note rather than finding a workaround.
6. If something still prompts despite all of the above, don't fight the dialog or try to suppress
   it -- stop that specific action, note it in the roadmap/handoff notes, and move to the next task.

## Long-running work / stuck-task detection

- Never run a test, build, or search command with no bound on how long it can run.
- Anything that has historically taken more than ~2 minutes (the full frontend vitest suite, a full
  ETL pipeline rebuild against the live site) goes in the background (`run_in_background: true`)
  rather than tying up a foreground wait.
- Don't poll a backgrounded task in a tight loop. Either keep making progress on independent
  roadmap work and let its completion notification arrive on its own, or schedule one wakeup at a
  delay matched to that task's realistic duration -- not a blind guess, and not so short that it
  fires repeatedly for no new information.
- Treat a backgrounded task as potentially stuck once it's run to roughly 2x its normal expected
  duration (e.g. vitest normally ~3 minutes; still running past ~6-8 minutes is a signal, not a
  reason to keep waiting silently). At that point, read its output file for a diagnosis -- no new
  output, a repeated error, something waiting on stdin it'll never get -- and either fix the root
  cause or stop it and retry narrower, rather than leaving it running indefinitely.
- Never let two consecutive scheduled wakeups pass on the same stuck task without taking a
  diagnostic action in between.
- Observed directly this session: a full `vitest run` once hung for 25+ minutes with CPU still
  climbing, well past every individual test's own declared timeout, then ran clean (134s, all
  passing) on an immediate retry -- a one-off environment fluke, not a reproduced bug. Two
  mitigations are now in place: `frontend/vite.config.ts`'s `testTimeout: 120_000` as a blanket
  per-test safety net, and always passing an explicit tool-level `timeout` to whichever tool runs
  `vitest` (a JS-level test timeout can't interrupt a genuinely-blocking synchronous call if one
  ever occurs, so the tool-level kill is the real backstop). Always invoke `vitest run` with a bound
  that kills the whole process, not just a bare invocation trusted to self-terminate.

## Reporting back

- `docs/skill-system-roadmap.md` is the durable record the owner will read on return -- keep each
  item's section current rather than relying on them reading the full transcript.
- The owner explicitly asked for autonomous progress, so don't pause mid-task waiting for
  confirmation the way a normal session would. This doesn't relax the system-level safety
  boundaries that don't bend for any user instruction (financial actions, credentials, publishing,
  messaging third parties, etc.) -- none of those are on this project's roadmap regardless.
