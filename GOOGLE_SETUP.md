# Google setup (MASTER), Windows click-by-click

Everything here is free with no card (Firebase Spark plan + AI Studio), except Part 9.
Use the Google account that will own the project. Button names can shift slightly; if
something doesn't match, describe what you see.

## Part 0 - Node 22+  [EVERYONE]
`node -v` must be v22 or newer (ADK and App Hosting need it).
Windows: `winget install OpenJS.NodeJS.LTS`, then close and reopen the terminal.
Mac: nodejs.org -> LTS.

## Part 1 - Firebase project
1. console.firebase.google.com -> **Create a project** (or "Get started")
2. Name: `agenthq` -> Continue. Google Analytics: **off** -> **Create project** -> Continue
3. Stay on the free **Spark** plan for now.

## Part 2 - Firestore
1. Left menu **Build -> Firestore Database -> Create database**
2. Edition (if asked): Standard. Location: `nam5 (United States)` (can't change later)
3. **Start in production mode** -> **Create**
4. **Rules** tab -> select all -> paste the contents of `firestore.rules` -> **Publish**
   (PowerShell: `Get-Content firestore.rules -Raw | Set-Clipboard`)

## Part 3 - Google sign-in (Firebase Auth)
1. **Build -> Authentication -> Get started**
2. **Sign-in method** tab -> **Google** -> **Enable** -> pick your support email -> **Save**
3. **Settings** tab -> **Authorized domains** -> **Add domain** -> your Vercel domain
   (e.g. `agenthq-xxxx.vercel.app`). `localhost` is already there.

## Part 4 - Web app config (browser keys, safe to expose)
1. Gear icon (top left) -> **Project settings -> General**
2. **Your apps** -> **Web** icon `</>` -> nickname `agenthq-web` -> leave Hosting unchecked -> **Register app**
3. Copy the values from `firebaseConfig` into .env.local:

       NEXT_PUBLIC_FIREBASE_API_KEY=...
       NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=agenthq-xxxx.firebaseapp.com
       NEXT_PUBLIC_FIREBASE_PROJECT_ID=agenthq-xxxx
       NEXT_PUBLIC_FIREBASE_APP_ID=1:...:web:...

4. Same page, at the top: copy **Project number** -> `NEXT_PUBLIC_GOOGLE_APP_ID=` (used by Picker)

## Part 5 - Server key (SECRET)
1. **Project settings -> Service accounts -> Generate new private key -> Generate key**
   A .json file downloads. Treat it like a password.
2. PowerShell (adjust the file name):

       [Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\agenthq-xxxx-firebase-adminsdk-xxxx.json")) | Set-Clipboard

3. In .env.local: `FIREBASE_SERVICE_ACCOUNT_B64=` + paste. Never commit the .json. Never paste it in chat.

## Part 6 - Gemini key (SECRET)
1. aistudio.google.com -> **Get API key -> Create API key**
2. Choose the **agenthq** project (import it if it's not listed) -> copy
3. .env.local: `GEMINI_API_KEY=...`

## Part 7 - Workspace APIs (for Phase 2; enable now)
console.cloud.google.com -> top project picker -> **agenthq** ->
**APIs & Services -> Library** -> search each and click **Enable**:
- Google Drive API
- Google Docs API
- Google Picker API
- Google Calendar API

## Part 8 - OAuth consent + client (for Drive/Docs/Calendar)
1. **APIs & Services -> OAuth consent screen** (may be called **Google Auth Platform**) -> **Get started**
   - App name: AgentHQ · Support email: you -> Next
   - Audience: **External** -> Next · Contact email: you -> Next -> agree -> **Create**
2. **Audience -> Test users -> Add users**: every teammate's Google email + the demo account -> Save
   (Testing mode: only these accounts can sign in. That's fine for a hackathon. Expect
   an "unverified app" screen; click Continue.)
3. **Data access -> Add or remove scopes** -> add:
   `.../auth/drive.file`, `.../auth/documents`, `.../auth/calendar.events`,
   `.../auth/calendar.freebusy` -> **Update -> Save**
   (`drive.file` only covers files the user picks or the app creates; with the Picker, that's all we need.)
4. **APIs & Services -> Credentials**:
   - Open **Web client (auto created by Google Service)** -> **Authorized JavaScript origins**
     -> add `http://localhost:3000` and `https://agenthq-xxxx.vercel.app` -> **Save**
     -> copy the **Client ID** -> `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...`
     (Google OAuth needs exact origins. Test Drive/Picker on port 3000, or add a worktree's port here.)
   - **Create credentials -> API key** -> **Edit API key** -> API restrictions: **Google Picker API**;
     Website restrictions: `http://localhost:3000/*`, `https://agenthq-xxxx.vercel.app/*`
     -> Save -> copy -> `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=...`

## Part 9 - Blaze (Phase 3 only: App Hosting, Cloud Storage, Cloud Run)
First ask the organizers for Google Cloud credits. If someone adds a card:
Firebase console -> **Upgrade** (bottom left) -> **Blaze** -> link billing, and set a
**budget alert** ($5). Usage stays inside no-cost limits for a hackathon.

## Part 10 - Env vars everywhere
.env.local now has (keep TEAM_JOIN_CODE; remove the Supabase lines once B's migration is merged):

    NEXT_PUBLIC_FIREBASE_API_KEY=
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=
    NEXT_PUBLIC_FIREBASE_APP_ID=
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=
    NEXT_PUBLIC_GOOGLE_APP_ID=
    FIREBASE_SERVICE_ACCOUNT_B64=
    GEMINI_API_KEY=
    TEAM_JOIN_CODE=

- Vercel: project -> **Settings -> Environment Variables** -> paste the block into a Key box -> Save -> **Deployments -> ... -> Redeploy**
- Teammates: DM them the block privately; they update their own .env.local.
