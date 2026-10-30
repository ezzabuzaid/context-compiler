# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/directory.ts`, with the folder named `startup-credits`.**
The app keeps its files in a `startup-credits` folder under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set, and makes the folder when the app starts. Each test gives the app a temporary `XDG_DATA_HOME`.

`datahub` (`apps/semantic-layer/elt/src/directory.ts`) has the same concept with one difference: its folder is `outputs/`, next to its code.
