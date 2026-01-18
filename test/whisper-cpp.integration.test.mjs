#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_MODEL_DIR = path.join(__dirname, 'models');
const TEST_AUDIO_DIR = path.join(__dirname, 'audio');
const MODEL_NAME = 'ggml-tiny.bin';
const MODEL_PATH = path.join(TEST_MODEL_DIR, MODEL_NAME);
const AUDIO_FILE = path.join(TEST_AUDIO_DIR, 'test.wav');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const SAMPLE_AUDIO_URL = 'https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav';

async function downloadFile(url, destPath, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (redirectUrl.startsWith('/')) {
          const urlObj = new URL(url);
          redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        return downloadFile(redirectUrl, destPath, maxRedirects - 1).then(resolve).catch(reject);
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

async function setup() {
  if (!fs.existsSync(TEST_MODEL_DIR)) {
    fs.mkdirSync(TEST_MODEL_DIR, { recursive: true });
  }

  if (!fs.existsSync(TEST_AUDIO_DIR)) {
    fs.mkdirSync(TEST_AUDIO_DIR, { recursive: true });
  }

  if (!fs.existsSync(MODEL_PATH) || fs.statSync(MODEL_PATH).size === 0) {
    if (fs.existsSync(MODEL_PATH)) fs.unlinkSync(MODEL_PATH);
    console.log(`Downloading Whisper tiny model to ${MODEL_PATH}...`);
    console.log('This may take a few minutes on first run.');
    await downloadFile(MODEL_URL, MODEL_PATH);
    console.log('Model downloaded successfully.');
  }

  if (!fs.existsSync(AUDIO_FILE) || fs.statSync(AUDIO_FILE).size === 0) {
    if (fs.existsSync(AUDIO_FILE)) fs.unlinkSync(AUDIO_FILE);
    console.log(`Downloading sample audio to ${AUDIO_FILE}...`);
    await downloadFile(SAMPLE_AUDIO_URL, AUDIO_FILE);
    console.log('Audio downloaded successfully.');
  }
}

const originalEnv = { ...process.env };

function resetEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, originalEnv);
}

async function runTests() {
  await setup();

  const results = [];

  delete process.env.WHISPER_CPP_MODEL_PATH;
  process.env.WHISPER_CPP_MODEL_PATH = MODEL_PATH;

  console.log('\n--- Running Whisper.cpp Integration Tests ---\n');

  // Test 1: Basic transcription
  try {
    console.log('Test 1: Basic transcription from file');
    const { transcribe, freeWhisper } = await import('../dist/esm/index.js');

    const result = await transcribe(AUDIO_FILE);

    if (!result || typeof result.text !== 'string') {
      throw new Error('Result should have text property');
    }

    if (result.text.length === 0) {
      throw new Error('Transcription should not be empty');
    }

    console.log(`  Transcribed: "${result.text.substring(0, 100)}..."`);
    console.log('  ✓ PASSED\n');
    results.push({ name: 'Basic transcription', passed: true });

    await freeWhisper();
  } catch (error) {
    console.log(`  ✗ FAILED: ${error.message}\n`);
    results.push({ name: 'Basic transcription', passed: false, error: error.message });
  }

  // Test 2: Transcription from Buffer
  try {
    console.log('Test 2: Transcription from Buffer');
    const { transcribeBuffer, freeWhisper } = await import('../dist/esm/index.js');

    const audioBuffer = fs.readFileSync(AUDIO_FILE);
    const result = await transcribeBuffer(audioBuffer);

    if (!result || typeof result.text !== 'string') {
      throw new Error('Result should have text property');
    }

    if (result.text.length === 0) {
      throw new Error('Transcription should not be empty');
    }

    console.log(`  Transcribed: "${result.text.substring(0, 100)}..."`);
    console.log('  ✓ PASSED\n');
    results.push({ name: 'Transcription from Buffer', passed: true });

    await freeWhisper();
  } catch (error) {
    console.log(`  ✗ FAILED: ${error.message}\n`);
    results.push({ name: 'Transcription from Buffer', passed: false, error: error.message });
  }

  // Test 3: isWhisperConfigured
  try {
    console.log('Test 3: isWhisperConfigured check');
    const { isWhisperConfigured } = await import('../dist/esm/index.js');

    const configured = isWhisperConfigured();

    if (configured !== true) {
      throw new Error('isWhisperConfigured should return true when model is set');
    }

    console.log('  ✓ PASSED\n');
    results.push({ name: 'isWhisperConfigured', passed: true });
  } catch (error) {
    console.log(`  ✗ FAILED: ${error.message}\n`);
    results.push({ name: 'isWhisperConfigured', passed: false, error: error.message });
  }

  // Test 4: Error handling for invalid model path
  try {
    console.log('Test 4: Error handling for invalid model path');

    const savedPath = process.env.WHISPER_CPP_MODEL_PATH;
    process.env.WHISPER_CPP_MODEL_PATH = '/invalid/path/model.bin';

    // Need to reimport to get fresh state
    const module = await import('../dist/esm/index.js?v=' + Date.now());

    let errorThrown = false;
    try {
      await module.transcribe(AUDIO_FILE);
    } catch (e) {
      errorThrown = true;
      if (!e.message.includes('not found')) {
        throw new Error(`Expected "not found" error, got: ${e.message}`);
      }
    }

    if (!errorThrown) {
      throw new Error('Should have thrown an error for invalid model path');
    }

    process.env.WHISPER_CPP_MODEL_PATH = savedPath;

    console.log('  ✓ PASSED\n');
    results.push({ name: 'Error handling for invalid model path', passed: true });
  } catch (error) {
    console.log(`  ✗ FAILED: ${error.message}\n`);
    results.push({ name: 'Error handling for invalid model path', passed: false, error: error.message });
  }

  // Summary
  console.log('--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  resetEnv();

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
  process.exit(0);
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
