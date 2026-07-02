# Publish My Next Bus with GitHub Pages

GitHub Pages hosts this app without a home server. After publication, the
tablet talks directly to the official KMB/LWB and Citybus feeds. Your saved
routes remain in the tablet browser and are not committed to GitHub.

## What you need

- A GitHub account.
- GitHub Desktop on the Windows PC, or equivalent Git command-line knowledge.
- A public repository when using the GitHub Free plan.
- An Android tablet with current Chrome, working Wi-Fi, and automatic date and
  time enabled.

## 1. Put the source in a GitHub repository

The easiest method on Windows is GitHub Desktop:

1. Install and sign in to GitHub Desktop.
2. Select **File → Add local repository**.
3. Choose the `my-next-bus` source folder.
4. If GitHub Desktop says it is not yet a repository, choose **Create a
   repository here**.
5. Use `my-next-bus` as the repository name and `main` as the default branch.
6. Commit all files with a summary such as `Initial tablet bus board`.
7. Select **Publish repository**.
8. Clear **Keep this code private** so GitHub Pages works with GitHub Free, then
   publish it.

Do not add Wi-Fi passwords or other secrets. This project does not need any.

## 2. Enable GitHub Pages

1. Open the new repository on github.com.
2. Select **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Select the repository's **Actions** tab.
5. Open **Deploy My Next Bus to GitHub Pages**.
6. Select **Run workflow → Run workflow**.
7. Wait for both the build and deploy jobs to show green checks.

The first workflow run may have failed if it ran before Pages was enabled. That
is harmless; run it again after completing the settings above.

## 3. Open the site

For a repository called `my-next-bus`, the normal address is:

```text
https://YOUR-GITHUB-USERNAME.github.io/my-next-bus/
```

The deployment job also displays the exact address. Open it on a computer once
and confirm that **My Next Bus** and the **Route** button appear.

## 4. Install it on the Android tablet

1. Open the GitHub Pages address in Chrome on the tablet.
2. Let the page finish loading, then open Chrome's three-dot menu.
3. Choose **Add to Home screen** and then **Install**. Some Chrome versions show
   **Install app** directly.
4. Launch **My Next Bus** from its new home-screen icon.
5. Tap **Route**, select KMB or Citybus, choose the route and direction, and tap
   the family's boarding stop.
6. Add the other regularly used journeys.
7. Turn the tablet to landscape, tap **Keep awake**, and optionally use the
   fullscreen button.
8. Keep the tablet connected to a safe, good-quality charger for continuous
   display use.

## 5. Publish future changes

Commit and push changes with GitHub Desktop. Every push to `main` starts the
same workflow and updates the site automatically. The computer does not need to
remain powered after deployment.

## Troubleshooting

- **The workflow says Pages is not enabled:** repeat section 2, then rerun it.
- **The page is blank or assets return 404:** confirm the workflow, rather than
  the `out` folder, is being deployed. The workflow calculates the repository
  path automatically.
- **The installation option is absent:** update Chrome, reload the exact HTTPS
  Pages address once, and wait a few seconds.
- **Bus data will not load:** check Wi-Fi and automatic date/time. The app needs
  internet access for fresh ETA data.
- **A route disappeared:** remove it and add it again; operators occasionally
  change route variants or stop sequences.
