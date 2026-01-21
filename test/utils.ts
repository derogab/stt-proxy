import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Shared test directories and files
export const TEST_AUDIO_DIR = path.join(__dirname, 'audio');
export const AUDIO_FILE = path.join(TEST_AUDIO_DIR, 'jfk.wav');
export const JFK_AUDIO_URL = 'https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav';

export async function downloadFile(url: string, destPath: string, maxRedirects = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (redirectUrl.startsWith('/')) {
          const urlObj = new URL(url);
          redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        downloadFile(redirectUrl, destPath, maxRedirects - 1).then(resolve).catch(reject);
        return;
      } else if (response.statusCode === 200) {
        const file = fs.createWriteStream(destPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

export function normalizeTranscription(text: string): string {
  return text.toLowerCase().replace(/[.,!?]/g, '').trim();
}

export async function ensureAudioFile(): Promise<void> {
  if (!fs.existsSync(AUDIO_FILE) || fs.statSync(AUDIO_FILE).size === 0) {
    if (fs.existsSync(AUDIO_FILE)) fs.unlinkSync(AUDIO_FILE);
    console.log(`Downloading JFK test audio to ${AUDIO_FILE}...`);
    await downloadFile(JFK_AUDIO_URL, AUDIO_FILE);
    console.log('Audio downloaded successfully.');
  }
}
