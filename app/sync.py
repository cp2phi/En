"""The "sync" button: commit practice data and push it with git."""

import subprocess
from datetime import datetime
from pathlib import Path


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, timeout=120
    )


def sync(repo: Path, data_dir: str = "data", now: datetime | None = None) -> dict:
    """Commit everything under data_dir, pull (rebase), then push.

    Only data_dir is committed, so unfinished code changes are never uploaded.
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
    if not (repo / data_dir).is_dir():
        return fail("还没有练习数据。")

    if run("add", "--", data_dir).returncode != 0:
        return fail("git add 失败。")
    committed = False
    if _git(repo, "diff", "--cached", "--quiet", "--", data_dir).returncode != 0:
        stamp = (now or datetime.now()).strftime("%Y-%m-%d %H:%M")
        if run("commit", "-m", f"practice: sync {stamp}", "--", data_dir).returncode != 0:
            return fail("git commit 失败。")
        committed = True

    if not _git(repo, "remote").stdout.strip():
        return fail("已保存到本地提交，但仓库没有配置远程地址，无法上传。")

    has_upstream = _git(repo, "rev-parse", "--abbrev-ref", "@{u}").returncode == 0
    if has_upstream:
        if run("pull", "--rebase", "--autostash").returncode != 0:
            _git(repo, "rebase", "--abort")
            return fail("拉取云端数据时有冲突，已取消。请手动处理后再同步。")
        push = run("push")
    else:
        push = run("push", "-u", "origin", "HEAD")
    if push.returncode != 0:
        return fail("上传失败，请检查网络或 git 登录状态。")

    message = "已同步到云端。" if committed else "没有新的练习数据，已和云端保持一致。"
    return {"ok": True, "message": message, "steps": steps}
