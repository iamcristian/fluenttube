# Security and private data

FluentTube is designed for one person on a local computer. Keep the API bound to loopback. It does not provide accounts or authorization for deployment as a public service.

## Credentials

- Put real provider keys only in `backend/.env`, copied from `.env.example`.
- Never put secrets in frontend variables: Vite exposes `VITE_*` values to the browser bundle.
- Keep YouTube session cookies outside Git. The app does not extract browser cookies automatically.
- Do not include `.env`, cookies, recordings, videos, model caches, databases or private logs in issues, screenshots or pull requests.
- Before publishing, run `python scripts/check_secrets.py --history` and review `git diff --cached` yourself. The script reports locations and credential types, not values.

If a real credential was ever committed, revoke or rotate it at its provider. Adding it to `.gitignore` does not remove the value from history. Review a history cleanup separately before pushing; do not rewrite shared history casually.

## Reporting a vulnerability

Do not post live credentials or personal media in a public issue. Use the repository owner's private contact method, or GitHub private vulnerability reporting if the owner has enabled it. Provide a minimal reproduction using synthetic data.

## External services

YouTube imports, optional cloud explanations, dictionary lookups and reference speech may use external services. Speech recognition for uploaded videos and practice recordings runs locally. Provider availability and usage limits are outside the app's control.
