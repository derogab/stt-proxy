import { config as loadDotenv } from 'dotenv';
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

// Load .env file explicitly at module load time
loadDotenv();

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const TEST_AUDIO_DIR = path.join(__dirname, 'audio');
const AUDIO_FILE = path.join(TEST_AUDIO_DIR, 'jfk.wav');

const JFK_AUDIO_URL = 'https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav';

async function downloadFile(url: string, destPath: string, maxRedirects = 10): Promise<void> {
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

function normalizeTranscription(text: string): string {
  return text.toLowerCase().replace(/[.,!?]/g, '').trim();
}

function isCloudflareConfigured(): boolean {
  return !!(process.env['CLOUDFLARE_ACCOUNT_ID'] && process.env['CLOUDFLARE_AUTH_KEY']);
}

describe('Cloudflare integration tests', () => {
  let transcribe: typeof import('../src/index.js').transcribe;

  beforeAll(async () => {
    if (!isCloudflareConfigured()) {
      console.log('Skipping Cloudflare integration tests: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY not configured');
      return;
    }

    // Ensure Whisper.cpp is not configured so Cloudflare is used
    delete process.env['WHISPER_CPP_MODEL_PATH'];

    // Download audio if needed
    if (!fs.existsSync(AUDIO_FILE) || fs.statSync(AUDIO_FILE).size === 0) {
      if (fs.existsSync(AUDIO_FILE)) fs.unlinkSync(AUDIO_FILE);
      console.log(`Downloading JFK test audio to ${AUDIO_FILE}...`);
      await downloadFile(JFK_AUDIO_URL, AUDIO_FILE);
      console.log('Audio downloaded successfully.');
    }

    // Import module
    const stt = await import('../src/index.js');
    transcribe = stt.transcribe;
  }, 60000); // 1 minute timeout for audio download

  it('should transcribe JFK speech audio file via Cloudflare', async () => {
    if (!isCloudflareConfigured()) {
      console.log('Test skipped: Cloudflare not configured');
      return;
    }

    const result = await transcribe(AUDIO_FILE);

    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    const normalizedResult = normalizeTranscription(result.text);
    expect(normalizedResult).toContain('ask not what your country can do for you');
  }, 60000); // 1 minute timeout for API call

  it('should transcribe audio from buffer via Cloudflare', async () => {
    if (!isCloudflareConfigured()) {
      console.log('Test skipped: Cloudflare not configured');
      return;
    }

    const audioBuffer = fs.readFileSync(AUDIO_FILE);
    const result = await transcribe(audioBuffer);

    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    const normalizedResult = normalizeTranscription(result.text);
    expect(normalizedResult).toContain('ask not what your country can do for you');
  }, 60000); // 1 minute timeout for API call

  it('should throw error for non-existent audio file', async () => {
    if (!isCloudflareConfigured()) {
      console.log('Test skipped: Cloudflare not configured');
      return;
    }

    await expect(transcribe('/non/existent/audio.wav')).rejects.toThrow('Audio file not found');
  });
});
