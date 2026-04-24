import { execFile } from 'child_process';
import path from 'path';

// Pick binary based on platform
const binaryName = process.platform === 'win32' ? 'gog.exe' : 'gog_linux';
// Resolving the binary path relative to the process working directory (apps/api)
const GOG_PATH = path.resolve(process.cwd(), `../../bin/${binaryName}`);

async function runGog(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    // Get account from env or default to empty
    const account = process.env.GMAIL_GOOGLE || '';
    
    // Add --account and --json to all commands to get structured output
    const finalArgs = [...args, '--json'];
    if (account) {
      finalArgs.push('--account', account);
    }
    
    execFile(GOG_PATH, finalArgs, {
      env: {
        ...process.env,
        GOG_KEYRING_BACKEND: 'file',
        GOG_PASSPHRASE: '',
        GOG_KEYRING_PASSWORD: '' // Added this specifically to solve the TTY error
      }
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('[GoogleService] Error:', stderr);
        return reject(error);
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        // Some commands might not return valid JSON even with --json flag if they fail or have empty output
        resolve(stdout);
      }
    });
  });
}

export const googleService = {
  // Gmail
  async listEmails(query: string = 'newer_than:7d', max: number = 10) {
    return runGog(['gmail', 'search', query, '--max', String(max)]);
  },

  async getEmailContent(id: string) {
    // gog gmail search supports id filtering? Let's check. 
    // Usually it's better to search specifically for the id.
    return runGog(['gmail', 'search', `id:${id}`, '--include-body']);
  },

  async createDraft(to: string, subject: string, body: string) {
    // Drafts create uses --body-file - for stdin, but execFile might be easier with args if body is short.
    // However, gog supports --body directly.
    return runGog(['gmail', 'drafts', 'create', '--to', to, '--subject', subject, '--body', body]);
  },

  // Calendar
  async listEvents(calendarId: string = 'primary', from?: string, to?: string) {
    const args = ['calendar', 'events', calendarId];
    if (from) args.push('--from', from);
    if (to) args.push('--to', to);
    return runGog(args);
  },

  async createEvent(calendarId: string = 'primary', summary: string, from: string, to: string, description?: string) {
    const args = ['calendar', 'create', calendarId, '--summary', summary, '--from', from, '--to', to];
    if (description) args.push('--description', description);
    return runGog(args);
  }
};
