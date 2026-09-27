# Setup

This takes about 20 minutes. Run every command from the repo folder in PowerShell or a terminal. You need Node.js 20 or later.

```bash
npm install
npx wrangler login          # opens a browser to sign in to Cloudflare
```

## 1. Create the database

```bash
npx wrangler d1 create task-tinder
```

Copy the `database_id` from the output into `wrangler.toml`, replacing the zeros.

## 2. Deploy once to get your URL

```bash
npm run deploy
```

Wrangler prints a URL like `https://task-tinder.<your-subdomain>.workers.dev`. This guide calls it **APP_URL**.

Open APP_URL/setup. It lists the two redirect URIs you need in the next steps:

- `APP_URL/oauth/ticktick/callback`
- `APP_URL/oauth/google/callback`

## 3. Set a passcode

```bash
npx wrangler secret put APP_PASSCODE      # what you'll type to sign in
npx wrangler secret put SESSION_SECRET    # any long random string
```

To generate a random string in PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))
```

## 4. Register a TickTick app

1. Go to <https://developer.ticktick.com> and select **Manage Apps**, then **+ App Name**.
2. Name it "Task Tinder" and set the **OAuth redirect URL** to `APP_URL/oauth/ticktick/callback`.
3. Store the app's credentials as secrets:

   ```bash
   npx wrangler secret put TICKTICK_CLIENT_ID
   npx wrangler secret put TICKTICK_CLIENT_SECRET
   ```

## 5. Create a Google OAuth client for Gmail

1. In the [Google Cloud Console](https://console.cloud.google.com), create a project (or reuse one). Then go to **APIs & Services**, select **Enable APIs**, and enable the **Gmail API**.
2. Go to **OAuth consent screen**:
   - Set the user type to **External**.
   - Add your Gmail address as a test user.
   - Add the scope `https://www.googleapis.com/auth/gmail.modify`. The app needs it to unstar an email when you complete it.
   - Then click **Publish app** so the app is **In production**.

   > In "Testing" status, Google expires the refresh token every 7 days, and you'd have to reconnect weekly. In production but unverified, Google shows a "Google hasn't verified this app" warning when you connect. Select **Advanced**, then **Go to Task Tinder**. That's fine for a personal app.
3. Go to **Credentials**, select **Create credentials**, then **OAuth client ID**. Choose **Web application** as the type. Under authorized redirect URIs, add `APP_URL/oauth/google/callback`.
4. Store the client's credentials as secrets:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_LOGIN_HINT   # optional: your Gmail address
   ```

## 6. Connect your accounts

1. Open APP_URL and sign in with your passcode.
2. Tap the ⚙ icon to open **Connections**.
3. Select **Connect** for TickTick, then for Gmail.
4. Go back to the deck.

## 7. Put it on your phone

Open APP_URL in Chrome on Android. Open the **⋮** menu and select **Add to Home screen**. It opens full-screen like an app.

## Tuning

Edit the `[vars]` section of `wrangler.toml`, then run `npm run deploy` again.

- `TICKTICK_EXCLUDE_PROJECTS` lists the TickTick lists to leave out, separated by commas. Emoji in list names are ignored when matching. The default is `Work,Someday,Backlog,Shopping`.
- `GMAIL_QUERY` is the Gmail search that decides which emails become cards. The default is `is:starred`. You could use `is:starred -category:promotions` instead, for example.
- `GMAIL_MAX` is the maximum number of starred threads per load. The default is 15.
- `SPRINT_SIZE` is how many queued cards start a sprint automatically. The default is 3.
- `TZ` is used to decide what "due today" means.

If the banner says "couldn't load: Inbox", your TickTick account may need its real inbox ID. Set `TICKTICK_INBOX_ID` under `[vars]` in `wrangler.toml`.

## Security notes

- Everything sits behind your passcode. The session cookie is HMAC-signed, HttpOnly and lasts 90 days.
- The OAuth tokens for TickTick and Gmail are stored in your private D1 database. To revoke access, disconnect on /setup and remove the app in your TickTick or Google account settings.
- If you'd like SSO instead of a passcode, you can put Cloudflare Access (Zero Trust, free for one user) in front of the Worker. Keep the passcode on as a second layer.
