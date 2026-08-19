<mark>Please read in full before downloading</mark>

# EnIAC — Patient Encounter Coding App

EnIAC is a desktop application for research studies where coders watch videos (or review documents) of clinical encounters and log timestamped observations while filling out structured forms.

---

## Downloading the App

### Step 1 — Go to the Releases page

Click **[Releases](https://github.com/aidenjohnson728/EnIAC/releases)** on the right side of this page, or go to:
**github.com/aidenjohnson728/EnIAC/releases**

### Step 2 — Download the right file for your computer

| Your computer | File to download |
|---|---|
| **Mac (Apple Silicon / M1, M2, M3, M4)** | `EnIAC-x.x.x-arm64.dmg` |
| **Windows** | `EnIAC.Setup.x.x.x.exe` |

> **Not sure which Mac you have?** Click the Apple menu () → About This Mac. If it says "Apple M1" (or M2, M3, M4), download the arm64 DMG.

### Step 3 — Install

**Mac:** Open the `.dmg` file, then drag the EnIAC icon into your Applications folder.

<mark>If macOS says "EnIAC cannot be opened because it is from an unidentified developer", run 'xattr -cr /Applications/EnIAC.app' in Terminal. This is expected since this app is not currently licensed and is a testing version.</mark>

**Windows:** Run the `.exe` installer and follow the prompts. If Windows Defender shows a warning, click **More info → Run anyway**.

---

## Updating the App

EnIAC checks GitHub Releases for newer versions. When an update is available, you will be notified in the app. On Windows, you will have an option to autoupdate within the app. On Mac, you will have to go to the GitHub releases page and reinstall the app from scratch. You can also always check the current version of the app and whether a newer version is available in the About tab in Settings.

## What EnIAC Does

EnIAC organizes research coding sessions around **Projects**, **Encounters**, and **Reviews**.

### Projects
A project holds everything for one study — its encounters, media files, forms, instructions, and coder settings. From the home screen you can start a **New Project** from a template (built-in ones like SDMo and UCAT, or a custom form someone on your team has built), or **Import Project** from a file someone has shared with you.

### Encounters
Each encounter represents one clinical session (e.g. a patient visit). An encounter can have one or more media files — videos or documents — that coders review.

### Reviews
When a coder opens a media file, they create a **Review**. Inside a review they can:
- **Log timestamps** — click a tag or press a keyboard shortcut to mark a moment in the video with a label and optional note
- **Fill out forms** — structured questionnaires that appear in tabs alongside the video
- **Submit** — mark the review complete when done

### Sharing a Project with a Team

When you share a project (Share Project on the project page), you assign each person a role — **Leader** or **Reviewer** — as part of one shared file. When someone imports that file, they pick their own name from the list you set up, which sets their role automatically. Reviewers see everything needed to code encounters, but won't see Settings, Agreement/Alignment, or the option to import others' results — that stays with Leaders.

### Multi-User / Sync

EnIAC supports syncing across multiple coders' machines so a team can work on the same project simultaneously.

- **OneDrive or Google Drive** — connect from Setup → Sync. Each coder connects their own account and points to the shared project folder. The app syncs automatically in the background.
- **Local folder** — point all machines to a shared network drive or a locally-synced cloud folder (Dropbox, OneDrive desktop sync, etc.)

The project Leader sets up the encounters, forms, and media types. Coders only need to import the shared project file, pick their name, and connect to the shared folder — they do not need to configure anything else.