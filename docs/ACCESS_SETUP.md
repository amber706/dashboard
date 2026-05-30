# Access & Local Setup — Admissions Copilot

How a new developer gets access to the three shared systems and runs the project locally.
Onboarding owner: **Amber Vaughan** (amber@cornerstonehealingcenter.com). `TODO(amber): set the right owner if delegating.`

---

## 1. Accounts to grant a new dev

Grant these **before** their first day so they're unblocked.

### GitHub — the code
- Repo: `github.com/amber706/dashboard`
- Add them as a **collaborator** (or to a team) with **Write** access.
  - `Settings → Collaborators and teams → Add people`.
- They'll fork-or-branch, open PRs, and merge to `main`.

### Vercel — hosting & previews
- Add them to the Vercel **team/project** that deploys this repo.
  - `Vercel → Project → Settings → Members` (or the Team members page).
- Gives them: deploy logs, preview URLs on each PR, runtime logs, and (if you want) the production env vars.
- Role: **Member** is enough for most devs; **Admin** only if they manage deploys/domains.

### Supabase — database, auth, RPCs
- Project: **`cornerstone-admissions-dev`** (ref `fortdxbbazifklqwydnk`), org `tembasgeqffskoihiwyw`.
- Invite them to the Supabase **organization/project**: `Supabase → Organization → Team → Invite`.
- Role: **Developer** for most; **Owner/Admin** only for whoever runs migrations against prod.
- ⚠️ This is a **dev** project. `TODO(amber): is there a separate prod Supabase project? If so, list it and who has access.`

### Claude Code — each dev runs their own
- Claude Code is **per-developer** — there's no shared session to invite people into.
- Each dev installs Claude Code and signs in with **their own** Claude subscription (Pro/Max) or Anthropic API key.
- Once they clone the repo, their Claude Code automatically picks up the shared brain: this repo's
  `CLAUDE.md`, `.claude/` settings, and `docs/`. No extra setup.
- Install: https://claude.com/claude-code  → then run `claude` inside the cloned repo.

---

## 2. Run the project locally

```bash
# 1. Clone
git clone https://github.com/amber706/dashboard.git admissions-copilot-frontend
cd admissions-copilot-frontend

# 2. Install (Node 20+ recommended; @types/node is v22)
npm install

# 3. Environment — create .env.local (gitignored, never commit it)
#    Values come from Supabase → Project Settings → API
cat > .env.local <<'EOF'
VITE_SUPABASE_URL=<from Supabase project settings>
VITE_SUPABASE_ANON_KEY=<the anon/public key>
EOF

# 4. Run
npm run dev          # http://localhost:5173

# 5. Before pushing
npm run typecheck && npm run test && npm run lint:metrics
```

The app **throws on startup** if the two `VITE_SUPABASE_*` vars are missing — that's the most
common "blank screen" cause for a new dev.

---

## 3. Login to the running app

The app is auth-gated (Supabase Auth). A new dev needs a user account **in the app**, separate
from their Supabase dashboard access.

- `TODO(amber): how are app user accounts created — admin invites them at /admin/users, or self-signup?`
- Roles inside the app: `specialist`, `manager`, `admin`. Most devs will want a **manager** or
  **admin** account to see the analytics/BD pages (they're manager-gated).
- `TODO(amber): who can mint admin accounts?`

---

## 4. Editing the database / RPCs

- Schema and RPCs are SQL migrations in `supabase/migrations/` (numbered; latest is `186_`).
- New change → **new** numbered migration file. Don't edit committed migrations.
- `TODO(amber): document the deploy path — Supabase CLI (\`supabase db push\`), the MCP \`apply_migration\` tool, or the dashboard SQL editor? And whether devs run against dev only, with you handling prod.`

---

## 5. Quick "is my access working?" checklist

- [ ] Can clone the repo and `git pull`
- [ ] `npm install` succeeds
- [ ] `.env.local` created with both Supabase vars
- [ ] `npm run dev` boots and shows the login page (not a blank/error screen)
- [ ] Can log into the app with an app user account
- [ ] Can see a PR's Vercel preview URL
- [ ] Can open the Supabase project dashboard
