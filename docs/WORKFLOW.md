# How the copies stay in step

There is ONE master copy: **GitHub, branch `main`**. Everything else is a copy:

- your Linux VM (a clone you work in),
- Replit (a clone Replit Agent works in),
- Railway (builds and publishes whatever is on `main`).

If a change is not on GitHub's `main`, the live app does not have it.

## The 10-second check (do it every time before you start work)
    cd ~/SightRead-AI
    bash scripts/check-sync.sh
It prints IN SYNC, BEHIND, AHEAD, NOT CLEAN or DIVERGED, and what to do next.
Run the same command in Replit's Shell.

## Daily routine on the Linux VM
1. `bash scripts/check-sync.sh`  (if BEHIND: `git pull`)
2. Do the work (or apply a patch: `git am yourpatch.patch`).
3. `pnpm --filter @workspace/sightread-ai test`   must be green.
4. `git push origin main`   (or push a branch, see below).
5. Watch GitHub: the **Actions** tab should show the "tests" check turn green.
   Then watch Railway's Deployments tab turn Success.

## Routine with Replit Agent
1. In Replit's Shell: `git fetch origin && git checkout -b replit-work origin/main`
   (Agent works on its OWN branch, never on `main`).
2. Give it ONE small task (see `docs/REPLIT_BRIEF.md`).
3. When it stops: `git status`, `git diff`, run the tests.
4. Only if green: `git push origin replit-work`, then open a pull request on GitHub.
   GitHub runs the tests on the pull request. Merge only when it is green.
5. Back on the VM: `git checkout main && git pull`.
Replit's own automatic checkpoints are NOT GitHub commits: nothing counts until it is pushed.

## Rules that prevent most breakage
- Never edit the same files in two places without pulling first.
- Never use `git push --force`, and never edit files on github.com unless you then `git pull`.
- Patch files (`*.patch`) are ignored by git on purpose; do not commit them.
- Changed `package.json`? Run `pnpm install` and commit the new `pnpm-lock.yaml` with it.
- Secrets never go in git. Replit Secrets and Railway Variables are separate lists, so a variable
  added in one is NOT in the other (for example AUDIVERIS_TIMEOUT_MS, AUDIVERIS_MAX_PAGES, OMR_DEBUG_RAW).

## Mark what works
After a version you have tested on a real phone:
    git tag known-good-$(date +%Y%m%d) && git push origin --tags

## If something breaks
- Live app broken: Railway -> Deployments -> choose the last Success -> Redeploy.
- Then fix the code: `git revert <bad-commit>` and push (revert adds a new commit; it never rewrites history).
- A copy says DIVERGED: stop. Save it first: `git branch backup-$(date +%Y%m%d)`.
  Then ask for help before pulling or pushing.

## One-time setup (about 10 minutes)
1. GitHub -> repository Settings -> Branches -> add a rule for `main`: require status checks to pass
   (select "tests") before merging.
2. Railway -> the service Settings: make sure the deploy branch is `main`. If the service offers
   "Wait for CI", turn it on so a red check blocks the deploy.
3. Replit: connect the project to this GitHub repository, and confirm its Shell shows `origin` as the
   same repo (`git remote -v`).
