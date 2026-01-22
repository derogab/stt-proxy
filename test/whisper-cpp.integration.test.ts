import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const TEST_MODEL_DIR = path.join(__dirname, 'models');
const TEST_AUDIO_DIR = path.join(__dirname, 'audio');
const MODEL_NAME = 'ggml-tiny.bin';
const MODEL_PATH = path.join(TEST_MODEL_DIR, MODEL_NAME);
const AUDIO_FILE = path.join(TEST_AUDIO_DIR, 'jfk.wav');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
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
          try {
            fs.unlinkSync(destPath);
          } catch {
            // Ignore cleanup errors to ensure original error is propagated
          }
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

describe('whisper.cpp integration tests', () => {
  let transcribe: typeof import('../src/index.js').transcribe;

  beforeAll(async () => {
    // Download model if needed
    if (!fs.existsSync(MODEL_PATH) || fs.statSync(MODEL_PATH).size === 0) {
      if (fs.existsSync(MODEL_PATH)) fs.unlinkSync(MODEL_PATH);
      console.log(`Downloading Whisper tiny model to ${MODEL_PATH}...`);
      console.log('This may take a few minutes on first run.');
      await downloadFile(MODEL_URL, MODEL_PATH);
      console.log('Model downloaded successfully.');
    }

    // Download audio if needed
    if (!fs.existsSync(AUDIO_FILE) || fs.statSync(AUDIO_FILE).size === 0) {
      if (fs.existsSync(AUDIO_FILE)) fs.unlinkSync(AUDIO_FILE);
      console.log(`Downloading JFK test audio to ${AUDIO_FILE}...`);
      await downloadFile(JFK_AUDIO_URL, AUDIO_FILE);
      console.log('Audio downloaded successfully.');
    }

    // Set model path
    process.env['WHISPER_CPP_MODEL_PATH'] = MODEL_PATH;

    // Import module
    const stt = await import('../src/index.js');
    transcribe = stt.transcribe;
  }, 600000); // 10 minute timeout for model download

  it('should transcribe JFK speech audio file', async () => {
    const result = await transcribe(AUDIO_FILE);

    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    const normalizedResult = normalizeTranscription(result.text);
    expect(normalizedResult).toContain('ask not what your country can do for you');
  }, 300000); // 5 minute timeout

  it('should transcribe audio from buffer', async () => {
    const audioBuffer = fs.readFileSync(AUDIO_FILE);
    const result = await transcribe(audioBuffer);

    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    const normalizedResult = normalizeTranscription(result.text);
    expect(normalizedResult).toContain('ask not what your country can do for you');
  }, 300000); // 5 minute timeout

  it('should throw error for non-existent audio file', async () => {
    await expect(transcribe('/non/existent/audio.wav')).rejects.toThrow('Audio file not found');
  });
});
