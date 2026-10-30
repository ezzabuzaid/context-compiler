# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`datahub` `apps/semantic-layer/elt/src/directory.ts` → `src/directory.ts`, without a change.**
The app keeps its files in its own `outputs/` folder, which the root `.gitignore` leaves out, and makes the folder when the app starts.

What is going on (`apps/what-is-going-on/src/directory.ts`) has the same concept with one difference: its folder is under `XDG_DATA_HOME`, or `~/.local/share` when that is not set.
