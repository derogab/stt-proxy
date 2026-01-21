import { config as loadDotenv } from 'dotenv';
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { AUDIO_FILE, ensureAudioFile, normalizeTranscription } from './utils.js';

// Load .env file explicitly at module load time
loadDotenv();

const isCloudflareConfigured = !!(process.env['CLOUDFLARE_ACCOUNT_ID'] && process.env['CLOUDFLARE_AUTH_KEY']);

describe.skipIf(!isCloudflareConfigured)('Cloudflare integration tests', () => {
  let transcribe: typeof import('../src/index.js').transcribe;

  beforeAll(async () => {
    // Ensure Whisper.cpp is not configured so Cloudflare is used
    delete process.env['WHISPER_CPP_MODEL_PATH'];

    // Download audio if needed
    await ensureAudioFile();

    // Import module
    const stt = await import('../src/index.js');
    transcribe = stt.transcribe;
  }, 60000); // 1 minute timeout for audio download

  it('should transcribe JFK speech audio file via Cloudflare', async () => {
    const result = await transcribe(AUDIO_FILE);

    expect(result).toBeDefined();
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    const normalizedResult = normalizeTranscription(result.text);
    expect(normalizedResult).toContain('ask not what your country can do for you');
  }, 60000); // 1 minute timeout for API call

  it('should transcribe audio from buffer via Cloudflare', async () => {
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
    await expect(transcribe('/non/existent/audio.wav')).rejects.toThrow('Audio file not found');
  });
});
