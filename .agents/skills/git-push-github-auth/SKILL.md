---
name: git-push-github-auth
description: Avoid the GitHub push rejection for workflow files ("refusing to allow an OAuth App to create or update workflow ... without workflow scope"). Use when pushing to a GitHub remote, or when a push is rejected over token scope.
---

# Push to GitHub without scope friction

## The failure mode

`git push` fails with:

```
remote rejected: refusing to allow an OAuth App to create or update workflow `.github/workflows/*.yml` without `workflow` scope
```

**Cause:** git authenticates with a token that lacks the `workflow` scope. This happens when git is using a stored OAuth token without `workflow` scope — i.e. there is no credential helper pointing at a token that has it (e.g. the `gh` token).

**Gotcha:** the scope check applies to the whole ref, not just the tip commit. A branch being pushed for the first time (no upstream) gets checked for **every commit in it** — so even a workflow file added several commits back blocks the push.

## Steps

### 1. Check the remote

```bash
git remote -v
```

If the push target is not GitHub, no scope check applies — push normally.

### 2. Verify git uses the gh token

```bash
git config --get credential.helper
```

If it is unset, or does not resolve to `gh auth git-credential`, run:

```bash
gh auth setup-git
```

This registers the `gh` CLI as git's credential helper, so git authenticates with the `gh` token. Idempotent and safe to run repeatedly.

### 3. Confirm the token has `workflow` scope

```bash
gh auth status
```

Look for `workflow` in `Token scopes`. If missing, the user must re-authenticate (interactive — cannot be automated):

```bash
gh auth refresh -h github.com -s workflow
```

Re-verify with `gh auth status` before pushing.

### 4. Check whether the push touches workflow files

The scope check applies whenever the pushed ref creates or updates a file under `.github/workflows/` — including earlier commits on a branch with no upstream yet.

```bash
git log --oneline -- .github/workflows/
```

If there are no workflow files in the pushed commits, scope doesn't matter — push as normal.

### 5. Push

```bash
git push --set-upstream origin <branch>   # first push
git push                                  # subsequent pushes
```

### 6. If rejected anyway

Re-run steps 2 and 3, then retry the exact push command.

## Verification checklist

- [ ] `gh auth status` shows `workflow` in `Token scopes`
- [ ] `git config --get credential.helper` resolves to `gh auth git-credential`
- [ ] Push succeeded

## Notes

- `workflow` scope is only needed for pushes that touch `.github/workflows/`; plain code pushes work with `repo` scope alone.
- A missing upstream is why a whole branch gets scope-checked at once, not just its tip commit.
