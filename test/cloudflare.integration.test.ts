import { config as loadDotenv } from 'dotenv';
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { AUDIO_FILE, ensureAudioFile, normalizeTranscription } from './utils.js';

// Load .env file explicitly at module load time
loadDotenv();

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
    await ensureAudioFile();

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
