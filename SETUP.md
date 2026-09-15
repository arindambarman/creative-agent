# Setup

Two ways to run this. Start with local mode — it works in minutes and lets you test the
phase prompts, which is where the real quality lives. Move to Supabase when you want sign-in,
saved projects across devices, and a shared key.

---

## Local mode (start here)

Nothing to configure. Each person uses their own Anthropic API key, stored in their own browser
and sent only to Anthropic.

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**, set Source to **Deploy from a branch**, pick `main`
   and `/ (root)`, then save. Your site appears at `https://<username>.github.io/<repo>/`.
3. Open it, click **Settings**, and paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com).
4. Go to **Studio brain** and fill in the three documents. Replace everything in [brackets].
5. Create a project, fill in the brief, and run Discover.

To run it on your own machine instead, from this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` directly as a file won't work, because
browsers block ES modules on `file://`.

**What local mode doesn't do:** projects live in one browser only, each person manages their own
key, and there's no sign-in. Clearing browser data deletes your projects — use **Export project**
to keep a copy.

---

## Supabase mode

Adds sign-in, projects saved to your account, per-user studio documents, version history, and one
shared API key that never touches the browser.

### 1. Create the project
Create a project at [supabase.com](https://supabase.com). From **Project Settings → API**, copy
the project URL and the `anon` public key. Note the project ref too: it's the `xxxxxxxx` in
`https://xxxxxxxx.supabase.co`.

### 2. Create the tables
Open the **SQL editor**, paste the contents of `supabase/schema.sql`, and run it. It's safe to
run again after pulling changes to the schema.

### 2b. Tell Supabase where sign-in links should go
In **Authentication → URL Configuration**:

- **Site URL:** `https://you.github.io/creative-agent/`
- **Redirect URLs:** add the same address, plus `http://localhost:8000/` if you test locally.

Without this, the magic link in the sign-in email sends people to `localhost:3000` and sign-in
never completes.

Supabase's built-in email sender only allows a few sign-in emails an hour. That's fine for two
or three people; for more, add your own SMTP server under **Authentication → Emails**.

### 3. Add yourself to the allowlist
Nobody can sign in until their email is listed. In the SQL editor:

```sql
insert into allowlist (email) values
  ('you@example.com'),
  ('your-friend@example.com');
```

### 4. Deploy the edge function

From this folder, using `npx` so nothing needs installing globally:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy run-phase
```

### 5. Point the app at it
In `js/config.js`, fill in the two empty values and leave the rest as it is:

```js
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGci...',
```

Commit and push. The header badge changes from `local` to `supabase` and a sign-in screen appears.

The anon key is safe to commit. It only allows what row-level security permits, and every table
filters by the signed-in user.

### 6. Lock down CORS
Set the sites allowed to call the function. Use the origin only, with no path — for a site at
`https://you.github.io/creative-agent/`, the origin is `https://you.github.io`. Separate several
with commas, for example to keep local testing working:

```bash
supabase secrets set ALLOWED_ORIGINS=https://you.github.io,http://localhost:8000
```

Until this is set, any site can call your function using a signed-in user's session. Secrets take
effect without redeploying.

---

## Controlling cost

With one shared key, everyone's usage bills to you. Two ways to handle it:

- **Budgets.** Each profile has a `monthly_token_budget`, checked by the edge function before every
  run. Adjust per user:
  `update profiles set monthly_token_budget = 300000 where email = 'friend@example.com';`
- **Their own key.** Have each person run in local mode with their own key. Simplest, and the cost
  sits with whoever is using it.

---

## Where to make changes

| What you want to change | File |
|---|---|
| What each phase asks for | `js/phases.js` |
| How the agent behaves overall | `SYSTEM` in `js/phases.js` |
| Starter studio documents for new users | `js/seed.js` |
| Model, Supabase connection | `js/config.js` |
| Look and layout | `index.html` |
| App behaviour and storage | `js/app.js` |
| Tables and permissions | `supabase/schema.sql` |

The prompts in `js/phases.js` are the part worth iterating on. Run a few real projects, notice
where the output is vague or wrong, and tighten the wording there rather than adding features.
