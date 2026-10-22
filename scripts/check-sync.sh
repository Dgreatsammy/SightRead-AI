#!/usr/bin/env bash
# Tells you whether THIS copy of the project (your Linux VM, or Replit's shell)
# matches GitHub, and whether it is safe to start work. Changes nothing.
#   Run it:  bash scripts/check-sync.sh
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

if ! git fetch origin --quiet 2>/dev/null; then
  echo "STOP: cannot reach GitHub. Check the internet connection, then run this again."
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
behind=$(git rev-list --count HEAD..origin/main)
ahead=$(git rev-list --count origin/main..HEAD)
changed=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')
patches=$(ls ./*.patch 2>/dev/null | wc -l | tr -d ' ')

echo "Branch:                 $branch"
echo "Behind GitHub's main:   $behind commit(s)"
echo "Ahead of GitHub's main: $ahead commit(s)"
echo "Edited, not committed:  $changed file(s)"
[ "$patches" != "0" ] && echo "Patch files lying here: $patches (fine; they are ignored by git)"
echo

if [ "$changed" != "0" ]; then
  echo "NOT CLEAN: you have edits that are not committed."
  echo "  -> Commit them (git add <files>; git commit -m \"...\") or put them aside before pulling."
elif [ "$behind" != "0" ] && [ "$ahead" != "0" ]; then
  echo "DIVERGED: this copy and GitHub each have commits the other lacks."
  echo "  -> STOP. Do not pull or push. Save this copy on a branch first:"
  echo "       git branch backup-\$(date +%Y%m%d)    then ask for help."
elif [ "$behind" != "0" ]; then
  echo "BEHIND: GitHub has newer work than this copy."
  echo "  -> Run:  git pull"
elif [ "$ahead" != "0" ]; then
  echo "AHEAD: this copy has commits GitHub does not have yet."
  echo "  -> Run the tests, then:  git push origin $branch"
else
  echo "IN SYNC: this copy matches GitHub's main. Safe to start work."
fi
