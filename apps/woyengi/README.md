# Woyengi shell

The local-first product shell keeps everyday navigation semantic: Home, Work, Apps, Inbox, Search, and one Ask/Create/Delegate surface. Constitutional state details remain behind Inspect mode.

Run the demo from the repository root:

```powershell
node apps/woyengi/src/demo.ts
```

Then open `http://127.0.0.1:4173`. Set `WOYENGI_SHELL_PORT` to use another port.

Run the browser QA harness without changing committed evidence:

```powershell
node apps/woyengi/test/visual-qa.mjs
```

Set `WOYENGI_VISUAL_UPDATE=1` only when intentionally refreshing the four
committed viewport/theme screenshots.
