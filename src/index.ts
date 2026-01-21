import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Whisper, TranscribeResult } from 'smart-whisper';

// Cloudflare configuration
function getCloudflareConfig() {
  return {
    accountId: process.env['CLOUDFLARE_ACCOUNT_ID'],
    authKey: process.env['CLOUDFLARE_AUTH_KEY'],
  };
}

function isCloudflareConfigured(): boolean {
  const config = getCloudflareConfig();
  return !!(config.accountId && config.authKey);
}

export interface TranscribeOptions {
  language?: string;
  translate?: boolean;
}

export interface TranscribeOutput {
  text: string;
}

let whisperInstance: Whisper | null = null;
let currentModelPath: string | null = null;

function getWhisperModelPath(): string | undefined {
  return process.env['WHISPER_CPP_MODEL_PATH'];
}

function isWhisperConfigured(): boolean {
  const modelPath = getWhisperModelPath();
  return modelPath !== undefined && fs.existsSync(modelPath);
}

async function getWhisperInstance(): Promise<Whisper> {
  const modelPath = getWhisperModelPath();

  if (!modelPath) {
    throw new Error('WHISPER_CPP_MODEL_PATH environment variable is not set');
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found at path: ${modelPath}`);
  }

  if (whisperInstance && currentModelPath === modelPath) {
    return whisperInstance;
  }

  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
  }

  const { Whisper } = await import('smart-whisper');
  whisperInstance = new Whisper(modelPath, { gpu: true });
  currentModelPath = modelPath;

  return whisperInstance;
}

function audioToPcm(audioPath: string): Float32Array {
  const tempDir = os.tmpdir();
  const tempPcmPath = path.join(tempDir, `whisper_${Date.now()}_${Math.random().toString(36).substring(7)}.pcm`);

  try {
    execSync(
      `ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -f f32le "${tempPcmPath}"`,
      { stdio: 'pipe' }
    );

    const pcmBuffer = fs.readFileSync(tempPcmPath);
    return new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 4);
  } finally {
    if (fs.existsSync(tempPcmPath)) {
      fs.unlinkSync(tempPcmPath);
    }
  }
}

function cleanTranscription(text: string): string {
  return text
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

function resultsToText(results: TranscribeResult<'simple'>[]): string {
  return results.map((r) => r.text).join(' ');
}

async function transcribe_whispercpp(audioPath: string, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const whisper = await getWhisperInstance();
  const pcmData = audioToPcm(audioPath);

  const transcribeParams: { language?: string; translate?: boolean; format: 'simple' } = {
    format: 'simple',
  };

  if (options.language !== undefined) {
    transcribeParams.language = options.language;
  }

  if (options.translate !== undefined) {
    transcribeParams.translate = options.translate;
  }

  const task = await whisper.transcribe(pcmData, transcribeParams);
  const results = await task.result;
  const text = resultsToText(results);

  return {
    text: cleanTranscription(text),
  };
}

interface CloudflareResponse {
  success: boolean;
  result?: {
    text: string;
  };
  errors?: Array<{ message: string }>;
}

async function transcribe_cloudflare(audioPath: string, _options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const config = getCloudflareConfig();

  if (!config.accountId || !config.authKey) {
    throw new Error('Cloudflare credentials not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY environment variables.');
  }

  const audioBuffer = fs.readFileSync(audioPath);

  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/@cf/openai/whisper-large-v3-turbo`;

  const body = JSON.stringify({
    audio: audioBuffer.toString('base64'),
    task: 'transcribe',
    vad_filter: true,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.authKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json() as CloudflareResponse;

  if (!data.success || !data.result) {
    const errorMessage = data.errors?.[0]?.message || 'Unknown Cloudflare API error';
    throw new Error(`Cloudflare transcription failed: ${errorMessage}`);
  }

  return {
    text: cleanTranscription(data.result.text),
  };
}

export async function transcribe(audio: string | Buffer, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  // Provider selection priority:
  // 1. Whisper.cpp (local, highest priority)
  // 2. Cloudflare

  if (isWhisperConfigured()) {
    if (Buffer.isBuffer(audio)) {
      return transcribeBuffer(audio, options, 'whispercpp');
    }
    return transcribe_whispercpp(audio, options);
  }

  if (isCloudflareConfigured()) {
    if (Buffer.isBuffer(audio)) {
      return transcribeBuffer(audio, options, 'cloudflare');
    }
    return transcribe_cloudflare(audio, options);
  }

  throw new Error('No STT provider configured. Set WHISPER_CPP_MODEL_PATH or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY environment variables.');
}

async function transcribeBuffer(audioBuffer: Buffer, options: TranscribeOptions = {}, provider: 'whispercpp' | 'cloudflare'): Promise<TranscribeOutput> {
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `stt_input_${Date.now()}_${Math.random().toString(36).substring(7)}.audio`);

  fs.writeFileSync(tempPath, audioBuffer);

  try {
    if (provider === 'cloudflare') {
      return await transcribe_cloudflare(tempPath, options);
    }
    return await transcribe_whispercpp(tempPath, options);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

async function freeWhisper(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
    currentModelPath = null;
  }
}

// Automatically clean up Whisper instance on process exit
process.on('exit', () => {
  if (whisperInstance) {
    // Note: Cannot use async operations in 'exit' handler
    // The instance will be cleaned up by the process termination
    whisperInstance = null;
    currentModelPath = null;
  }
});

// Handle graceful shutdown signals
const shutdownHandler = async () => {
  await freeWhisper();
  process.exit(0);
};

process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
