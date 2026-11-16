import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The user's own Google OAuth client, as Google Cloud Console downloads a
// Desktop client: {"installed":{"client_id","client_secret",…}}, the file gws
// keeps as ~/.config/gws/client_secret.json. It is read on each sign-in.
export class GoogleClientFile {
  readonly path: string;

  // directory: the CLI's configuration folder.
  constructor(directory: string) {
    this.path = join(directory, 'client_secret.json');
  }

  async read(): Promise<{ clientId: string; clientSecret: string }> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (Error.isError(error) && 'code' in error && error.code === 'ENOENT')
        throw new Error(
          `Calendar's Drive and Gmail attachments need your Google OAuth client in ${this.path}. In Google Cloud Console › APIs & Services › Credentials, create an OAuth client ID of type Desktop app in a project with the Drive and Gmail APIs enabled, download its JSON and save it as ${this.path}.`,
          { cause: error },
        );
      throw error;
    }
    const { installed } = JSON.parse(text);
    if (
      typeof installed?.client_id !== 'string' ||
      typeof installed?.client_secret !== 'string'
    )
      throw new Error(
        `${this.path} holds no Desktop OAuth client. Download the JSON of an OAuth client ID of type Desktop app from Google Cloud Console › APIs & Services › Credentials and save it there.`,
      );
    return {
      clientId: installed.client_id,
      clientSecret: installed.client_secret,
    };
  }
}
