# Backup and publishing

## Source code vs. personal data

The repository backs up application code, dependency lockfiles, safe configuration templates and documentation. It deliberately excludes databases, imported media, speech models, recordings, logs and real credentials.

To back up your practice data with the default settings:

1. Stop the application completely so no import or database write is running.
2. Copy `backend/data/fluenttube.db` and `backend/media_cache/` together to a private backup location. If `DATABASE_URL` or `MEDIA_ROOT` was changed, use those configured locations instead. Relative paths resolve from `backend/`.
3. Keep `backend/.env` in a secure private backup if you need its configuration. Do not upload it to the repository.

Browser drafts and preferences live in browser local storage. The SQLite backup preserves saved library and exercise progress, but does not include unsubmitted browser drafts or preferences. Model files in `backend/data/models/` are optional for backup and can be downloaded again.

## Before your first push

Run from the project root:

```powershell
.\backend\.venv\Scripts\python.exe scripts/check_secrets.py --history
git status --short
git add .
git diff --cached --stat
git diff --cached
```

Review the staged files. Only `.env.example` templates should appear; real configuration, media, databases and generated folders must stay excluded. The credential scan recognizes common formats but cannot detect every possible secret. Re-run it after making changes.

Once satisfied:

```powershell
git commit -m "Prepare FluentTube for GitHub"
```

Create an empty GitHub repository with the desired visibility. Add its actual URL with `git remote add origin <YOUR_REPOSITORY_URL>` if there is no existing remote. Use `git remote -v` and `git branch --show-current` to check the destination and current branch before pushing with `git push -u origin HEAD`. Avoid force pushes.

No repository is created and no code is uploaded by these documentation changes.

## Portfolio presentation

- Suggested description: **Local-first English practice with video dictation, shadowing and speech recognition. Built with React, TypeScript and FastAPI.**
- Suggested topics: `english-learning`, `react`, `typescript`, `fastapi`, `speech-recognition`, `whisper`, `sqlite`, `local-first`.
- If adding screenshots, use your own or openly licensed media and synthetic practice data. Keep personal titles, drafts and credentials out of the images.
- The README banner is a repository-owned SVG graphic, not a screenshot of the application.
- Do not include a live-demo link until a suitable deployment exists. This repository currently documents a local desktop workflow.

## Repository automation

The GitHub workflow checks common credential formats (including available Git history), runs frontend tests, and builds the frontend. Backend tests are run locally with `npm run test:backend`; live YouTube tests are disabled by default.
