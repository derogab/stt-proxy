import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AUDIO_FILE, downloadFile, ensureAudioFile, normalizeTranscription } from './utils.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const TEST_MODEL_DIR = path.join(__dirname, 'models');
const MODEL_NAME = 'ggml-tiny.bin';
const MODEL_PATH = path.join(TEST_MODEL_DIR, MODEL_NAME);

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';

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
    await ensureAudioFile();

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
