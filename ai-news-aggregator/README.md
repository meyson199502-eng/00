# AI News Aggregator

A Next.js app that aggregates posts from AI-related subreddits (r/artificial, r/ChatGPT, r/LocalLLaMA, r/singularity, r/OpenAI).

## ⚙️ Setup: Reddit API Credentials (required)

Reddit blocks anonymous requests from cloud/server IPs with 403 errors.  
The app uses Reddit's **OAuth2 client credentials** flow which works from any IP.

### Step 1 — Create a free Reddit app (~2 minutes)

1. Log in to Reddit and go to: **<https://www.reddit.com/prefs/apps>**
2. Scroll down and click **"create another app"**
3. Fill in the form:
   - **Name:** `ai-news-aggregator` (or anything)
   - **App type:** `script` ← **important**
   - **Redirect URI:** `http://localhost:3000`
4. Click **"create app"**
5. Note the two values:
   - Short string **under the app name** → `REDDIT_CLIENT_ID`
   - **"secret"** field → `REDDIT_CLIENT_SECRET`

### Step 2 — Add credentials to `.env.local`

```bash
cp .env.local.example .env.local
# then edit .env.local and fill in your values
```

```env
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
```

### Step 3 — Deploy to Vercel

Add the same two variables in **Vercel → Project Settings → Environment Variables**.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDDIT_CLIENT_ID` | ✅ yes | The short string shown under your app name on reddit.com/prefs/apps |
| `REDDIT_CLIENT_SECRET` | ✅ yes | The "secret" field of your Reddit app |

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How it works

```
Browser → /api/reddit?subreddit=ChatGPT
           ↓
        Next.js API route (Node runtime)
           ↓
        POST reddit.com/api/v1/access_token  (Basic auth with client_id:secret)
           ↓  token cached in-process for 1 hour
        GET oauth.reddit.com/r/ChatGPT/hot.json  (Bearer token)
           ↓
        JSON posts returned to browser
```

Reddit's `oauth.reddit.com` endpoint is not IP-blocked — it works from Vercel, AWS, and any other cloud provider.

---

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

Remember to add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` in your Vercel project settings.
