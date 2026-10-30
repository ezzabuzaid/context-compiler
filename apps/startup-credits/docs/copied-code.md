# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it (backlog #3371). Until then, a fix in one copy is made in the other copy too, and the commit names both files.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/main.ts`.**
Both apps keep their files in a folder under `XDG_DATA_HOME`, or `~/.local/share` when it is not set, and make the folder when the app starts.
These parts are different:

- What is going on exports the folder from `directory.ts`, and its tests set `XDG_DATA_HOME` before they import the app. This app makes the folder in `main.ts` and gives it to `watchStartupCredits` as a parameter, so its tests give a temporary folder.
