"""The "sync" button: commit the whole repository and push it with git.

Everything is uploaded (code, question banks, practice data, cached speech audio)
except the files in SECRET_FILES, which hold the OpenAI key.
"""

import subprocess
from datetime import datetime
from pathlib import Path

# Never committed, even if .gitignore is changed: a key pushed to GitHub gets leaked and revoked.
SECRET_FILES = ("config.local.json",)


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
        return fail("这个目录不是 git 仓库。")
    tracked_secrets = [f for f in SECRET_FILES if _git(repo, "ls-files", "--error-unmatch", f).returncode == 0]
    if tracked_secrets:
        return fail(f"{', '.join(tracked_secrets)} 已经被 git 跟踪，里面有 API key，为安全起见不同步。"
                    f"请先运行 git rm --cached {' '.join(tracked_secrets)}。")

    if run("add", "-A").returncode != 0:
        return fail("git add 失败。")
    # Unstage the key file in case .gitignore no longer covers it (it is not tracked, checked above).
    if _git(repo, "rm", "--cached", "--ignore-unmatch", "--quiet", "--", *SECRET_FILES).returncode != 0:
        return fail("无法把 API key 文件排除在提交之外，已停止同步。")
    committed = False
    if _git(repo, "diff", "--cached", "--quiet").returncode != 0:
        stamp = (now or datetime.now()).strftime("%Y-%m-%d %H:%M")
        if run("commit", "-m", f"sync: {stamp}").returncode != 0:
            return fail("git commit 失败。")
        committed = True

    if not _git(repo, "remote").stdout.strip():
        return fail("已保存到本地提交，但仓库没有配置远程地址，无法上传。")

    has_upstream = _git(repo, "rev-parse", "--abbrev-ref", "@{u}").returncode == 0
    if has_upstream:
        if run("pull", "--rebase", "--autostash").returncode != 0:
            _git(repo, "rebase", "--abort")
            return fail("拉取云端内容时有冲突，已取消。请手动处理后再同步。")
        push = run("push")
    else:
        push = run("push", "-u", "origin", "HEAD")
    if push.returncode != 0:
        return fail("上传失败，请检查网络或 git 登录状态。")

    message = "已同步到云端。" if committed else "没有新的改动，已和云端保持一致。"
    return {"ok": True, "message": message, "steps": steps}
