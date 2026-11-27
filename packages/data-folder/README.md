# @workspace/data-folder

An app of this repository keeps its files in a folder of its own under the user's data home.

```ts
import { dataFolder } from '@workspace/data-folder';

export default await dataFolder('websets', process.env);
```

`dataFolder(name, env)` makes the folder `name` under `XDG_DATA_HOME` of `env`, or under `~/.local/share` when `XDG_DATA_HOME` is not set, and gives its path. This is the data home of the XDG Base Directory Specification. The app reads its own environment and gives it to the package.

Each app awaits `dataFolder` once, at the top level of a module, so it reads the folder when that module is imported. So a test that gives the app a temporary `XDG_DATA_HOME` sets it before it imports the app, or starts the app in a child process with that env.

`xdg-basedir` gives the data home only. It does not make the folder, and it is a third-party dependency that no app has.
