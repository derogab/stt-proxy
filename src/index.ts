import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Whisper, TranscribeResult } from 'smart-whisper';

// ============================================================================
// Types
// ============================================================================

export interface TranscribeOptions {
  language?: string;
  translate?: boolean;
}

export interface TranscribeOutput {
  text: string;
}

interface CloudflareResponse {
  success: boolean;
  result?: { text: string };
  errors?: Array<{ message: string }>;
}

// ============================================================================
// Shared utilities
// ============================================================================

function cleanTranscription(text: string): string {
  return text.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

function generateTempPath(prefix: string, extension: string): string {
  const randomId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  return path.join(os.tmpdir(), `${prefix}_${randomId}.${extension}`);
}

// ============================================================================
// Whisper.cpp provider
// ============================================================================

let whisperInstance: Whisper | null = null;
let currentModelPath: string | null = null;

function isWhisperConfigured(): boolean {
  const modelPath = process.env['WHISPER_CPP_MODEL_PATH'];
  return !!modelPath && fs.existsSync(modelPath);
}

async function getWhisperInstance(): Promise<Whisper> {
  const modelPath = process.env['WHISPER_CPP_MODEL_PATH'];

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
  const tempPcmPath = generateTempPath('whisper', 'pcm');

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

function resultsToText(results: TranscribeResult<'simple'>[]): string {
  return results.map((r) => r.text).join(' ');
}

async function transcribeWithWhisper(audioPath: string, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const whisper = await getWhisperInstance();
  const pcmData = audioToPcm(audioPath);

  const transcribeParams = {
    format: 'simple' as const,
    ...(options.language !== undefined && { language: options.language }),
    ...(options.translate !== undefined && { translate: options.translate }),
  };

  const task = await whisper.transcribe(pcmData, transcribeParams);
  const results = await task.result;

  return { text: cleanTranscription(resultsToText(results)) };
}

// ============================================================================
// Cloudflare provider
// ============================================================================

function isCloudflareConfigured(): boolean {
  return !!(process.env['CLOUDFLARE_ACCOUNT_ID'] && process.env['CLOUDFLARE_AUTH_KEY']);
}

async function transcribeWithCloudflare(audioPath: string, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const authKey = process.env['CLOUDFLARE_AUTH_KEY'];

  if (!accountId || !authKey) {
    throw new Error('Cloudflare credentials not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY environment variables.');
  }

  const audioBuffer = fs.readFileSync(audioPath);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper-large-v3-turbo`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio: audioBuffer.toString('base64'),
      task: options.translate ? 'translate' : 'transcribe',
      vad_filter: true,
      ...(options.language && { language: options.language }),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json() as CloudflareResponse;

  if (!data.success || !data.result?.text) {
    const errorMessage = data.errors?.[0]?.message || 'Unknown Cloudflare API error';
    throw new Error(`Cloudflare transcription failed: ${errorMessage}`);
  }

  return { text: cleanTranscription(data.result.text) };
}

// ============================================================================
// Main transcribe function
// ============================================================================

type Provider = 'whisper.cpp' | 'cloudflare';

function selectProvider(): Provider {
  // Check for explicit provider selection
  const explicitProvider = process.env['PROVIDER']?.toLowerCase();

  if (explicitProvider) {
    // Validate explicit provider configuration
    switch (explicitProvider) {
      case 'whisper.cpp':
        if (!isWhisperConfigured()) {
          throw new Error("PROVIDER is set to 'whisper.cpp' but WHISPER_CPP_MODEL_PATH is not configured or model file does not exist.");
        }
        return 'whisper.cpp';
      case 'cloudflare':
        if (!isCloudflareConfigured()) {
          throw new Error("PROVIDER is set to 'cloudflare' but CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY are not configured.");
        }
        return 'cloudflare';
      default:
        throw new Error(`Unknown provider: ${explicitProvider}. Valid providers are: whisper.cpp, cloudflare`);
    }
  }

  // Auto-detection priority: whisper.cpp > cloudflare
  if (isWhisperConfigured()) return 'whisper.cpp';
  if (isCloudflareConfigured()) return 'cloudflare';

  throw new Error('No STT provider configured. Set WHISPER_CPP_MODEL_PATH or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY environment variables.');
}

async function transcribeFromPath(audioPath: string, options: TranscribeOptions, provider: Provider): Promise<TranscribeOutput> {
  if (provider === 'cloudflare') {
    return transcribeWithCloudflare(audioPath, options);
  }
  return transcribeWithWhisper(audioPath, options);
}

async function transcribeFromBuffer(audioBuffer: Buffer, options: TranscribeOptions, provider: Provider): Promise<TranscribeOutput> {
  const tempPath = generateTempPath('stt_input', 'audio');
  fs.writeFileSync(tempPath, audioBuffer);

  try {
    return await transcribeFromPath(tempPath, options, provider);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export async function transcribe(audio: string | Buffer, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  const provider = selectProvider();

  return Buffer.isBuffer(audio)
    ? transcribeFromBuffer(audio, options, provider)
    : transcribeFromPath(audio, options, provider);
}

// ============================================================================
// Cleanup handlers
// ============================================================================

async function freeWhisper(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
    currentModelPath = null;
  }
}

process.on('exit', () => {
  if (whisperInstance) {
    // Note: Cannot use async operations in 'exit' handler
    // The instance will be cleaned up by the process termination
    whisperInstance = null;
    currentModelPath = null;
  }
});

const shutdownHandler = async () => {
  await freeWhisper();
  process.exit(0);
};

process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
