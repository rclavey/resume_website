#!/usr/bin/env python3
"""Build predictor website data in an isolated worktree and publish it to GitHub Pages."""

from __future__ import annotations

import argparse
import fcntl
import os
import subprocess
import sys
import tempfile
from pathlib import Path


RESUME_REPO = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = {
    "ufc": Path("/Users/richie/Documents/git_hub/elo_project/ufc"),
    "hockey": Path("/Users/richie/Documents/eloSports/NHL"),
    "march-madness": Path("/Users/richie/Documents/eloSports/MarchMadness"),
}
OUTPUT_PATHS = {
    "ufc": ["data/ufc-dashboard.json", "data/ufc-model.json"],
    "hockey": ["data/hockey-dashboard.json"],
    "march-madness": ["data/march-madness-dashboard.json"],
}
COMMIT_MESSAGES = {
    "ufc": "Update UFC predictor data",
    "hockey": "Update Hockey Elo predictor data",
    "march-madness": "Update March Madness predictor data",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild one predictor's static website data and publish it to resume_website."
    )
    parser.add_argument("predictor", choices=sorted(DEFAULT_SOURCES))
    parser.add_argument("--source", type=Path, help="Override the local predictor project path.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and report changes without committing or pushing.",
    )
    return parser.parse_args()


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command), flush=True)
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture,
    )


def build_commands(predictor: str, source: Path, worktree: Path) -> list[list[str]]:
    python = sys.executable
    scripts = worktree / "scripts"
    if predictor == "ufc":
        return [
            [
                python,
                str(scripts / "build_ufc_dashboard_data.py"),
                "--source",
                str(source),
                "--output",
                str(worktree / "data/ufc-dashboard.json"),
            ],
            [
                python,
                str(scripts / "build_ufc_model_bundle.py"),
                "--source",
                str(source),
                "--output",
                str(worktree / "data/ufc-model.json"),
            ],
        ]
    if predictor == "hockey":
        return [[
            python,
            str(scripts / "build_hockey_dashboard_data.py"),
            "--nhl-root",
            str(source),
            "--output",
            str(worktree / "data/hockey-dashboard.json"),
        ]]
    return [[
        python,
        str(scripts / "build_march_madness_dashboard_data.py"),
        "--project-root",
        str(source),
        "--output",
        str(worktree / "data/march-madness-dashboard.json"),
    ]]


def publish(predictor: str, source: Path, dry_run: bool) -> int:
    if not source.is_dir():
        raise FileNotFoundError(f"Predictor source directory does not exist: {source}")

    run(["git", "fetch", "origin", "main"], cwd=RESUME_REPO)
    with tempfile.TemporaryDirectory(prefix=f"resume-{predictor}-") as temporary_directory:
        worktree = Path(temporary_directory) / "site"
        run(["git", "worktree", "add", "--detach", str(worktree), "origin/main"], cwd=RESUME_REPO)
        try:
            for command in build_commands(predictor, source, worktree):
                run(command, cwd=worktree)

            paths = OUTPUT_PATHS[predictor]
            status = run(
                ["git", "status", "--short", "--", *paths],
                cwd=worktree,
                capture=True,
            ).stdout.strip()
            if not status:
                print(f"{predictor}: website data is already current.", flush=True)
                return 0
            print(status, flush=True)
            if dry_run:
                print(f"{predictor}: dry run complete; no commit or push was made.", flush=True)
                return 0

            run(["git", "add", "--", *paths], cwd=worktree)
            run(["git", "commit", "-m", COMMIT_MESSAGES[predictor]], cwd=worktree)
            try:
                run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
            except subprocess.CalledProcessError:
                print("Remote main changed during the build; rebasing once and retrying.", flush=True)
                run(["git", "fetch", "origin", "main"], cwd=worktree)
                run(["git", "rebase", "origin/main"], cwd=worktree)
                run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
            print(
                f"Published {predictor} data. GitHub Pages will deploy from "
                "https://github.com/rclavey/resume_website/actions",
                flush=True,
            )
            return 0
        finally:
            run(["git", "worktree", "remove", "--force", str(worktree)], cwd=RESUME_REPO)


def main() -> int:
    args = parse_args()
    if os.environ.get("RESUME_WEBSITE_SKIP_PUBLISH") == "1":
        print("Predictor website publishing skipped by RESUME_WEBSITE_SKIP_PUBLISH=1.")
        return 0
    source = (args.source or DEFAULT_SOURCES[args.predictor]).expanduser().resolve()
    lock_path = Path(tempfile.gettempdir()) / "resume-website-predictor-publish.lock"
    with lock_path.open("w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        return publish(args.predictor, source, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
