"""The "sync" button: commit the whole repository and push it with git.

Everything is uploaded (code, question banks, practice data, cached speech audio)
except the files in SECRET_FILES, which hold the OpenAI key, and the folders in
PRIVATE_DIRS, which hold practice about real work projects. The repository may be
public, so both are kept out even if .gitignore stops covering them.
"""

import subprocess
from datetime import datetime
from pathlib import Path

# Never committed, even if .gitignore is changed: a key pushed to GitHub gets leaked and revoked.
SECRET_FILES = ("config.local.json",)
# Never committed either: role-plays, notes, journal and audio about real (client) projects.
PRIVATE_DIRS = ("private",)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, timeout=300
    )


def sync(repo: Path, now: datetime | None = None) -> dict:
    """Commit every change in the repository, pull (rebase), then push.

    Returns {"ok": bool, "message": str, "steps": [{"cmd", "ok", "output"}]}.
    """
    repo = Path(repo)
    steps: list[dict] = []

    def run(*args: str) -> subprocess.CompletedProcess:
        result = _git(repo, *args)
        steps.append({
            "cmd": "git " + " ".join(args),
            "ok": result.returncode == 0,
            "output": (result.stdout + result.stderr).strip(),
        })
        return result

    def fail(message: str) -> dict:
        return {"ok": False, "message": message, "steps": steps}

    if _git(repo, "rev-parse", "--is-inside-work-tree").returncode != 0:
        return fail("This folder is not a git repository.")
    tracked_secrets = [f for f in SECRET_FILES if _git(repo, "ls-files", "--error-unmatch", f).returncode == 0]
    if tracked_secrets:
        return fail(f"{', '.join(tracked_secrets)} is tracked by git and contains your API key, so sync stopped. "
                    f"Run git rm --cached {' '.join(tracked_secrets)} first.")

    tracked_private = [d for d in PRIVATE_DIRS if _git(repo, "ls-files", "--", d).stdout.strip()]
    if tracked_private:
        return fail(f"{', '.join(tracked_private)}/ is tracked by git but holds private work notes, so sync stopped. "
                    f"Run git rm -r --cached {' '.join(tracked_private)} first.")

    if run("add", "-A").returncode != 0:
        return fail("git add failed.")
    # Unstage the key file in case .gitignore no longer covers it (it is not tracked, checked above).
    if _git(repo, "rm", "--cached", "--ignore-unmatch", "--quiet", "--", *SECRET_FILES).returncode != 0:
        return fail("Could not keep the API key file out of the commit, so sync stopped.")
    if _git(repo, "rm", "-r", "--cached", "--ignore-unmatch", "--quiet", "--", *PRIVATE_DIRS).returncode != 0:
        return fail("Could not keep the private folder out of the commit, so sync stopped.")
    committed = False
    if _git(repo, "diff", "--cached", "--quiet").returncode != 0:
        stamp = (now or datetime.now()).strftime("%Y-%m-%d %H:%M")
        if run("commit", "-m", f"sync: {stamp}").returncode != 0:
            return fail("git commit failed.")
        committed = True

    if not _git(repo, "remote").stdout.strip():
        return fail("Committed locally, but the repository has no remote to upload to.")

    has_upstream = _git(repo, "rev-parse", "--abbrev-ref", "@{u}").returncode == 0
    if has_upstream:
        if run("pull", "--rebase", "--autostash").returncode != 0:
            _git(repo, "rebase", "--abort")
            return fail("Changes from the remote conflict with yours, so the pull was cancelled. Resolve it by hand, then sync again.")
        push = run("push")
    else:
        push = run("push", "-u", "origin", "HEAD")
    if push.returncode != 0:
        return fail("Upload failed. Check your network and git login.")

    message = "Synced." if committed else "No new changes. Already up to date."
    return {"ok": True, "message": message, "steps": steps}
