import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Whisper, TranscribeResult } from 'smart-whisper';

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

export function isWhisperConfigured(): boolean {
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

export async function transcribe(audio: string | Buffer, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  const modelPath = getWhisperModelPath();

  if (modelPath) {
    if (Buffer.isBuffer(audio)) {
      return transcribeBuffer(audio, options);
    }
    return transcribe_whispercpp(audio, options);
  }

  throw new Error('No STT provider configured. Set WHISPER_CPP_MODEL_PATH environment variable.');
}

export async function transcribeBuffer(audioBuffer: Buffer, options: TranscribeOptions = {}): Promise<TranscribeOutput> {
  const modelPath = getWhisperModelPath();

  if (!modelPath) {
    throw new Error('No STT provider configured. Set WHISPER_CPP_MODEL_PATH environment variable.');
  }

  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `whisper_input_${Date.now()}_${Math.random().toString(36).substring(7)}.audio`);

  fs.writeFileSync(tempPath, audioBuffer);

  try {
    const result = await transcribe_whispercpp(tempPath, options);
    return result;
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export async function freeWhisper(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
    currentModelPath = null;
  }
}

export function getAvailableModels(): string[] {
  return [
    'tiny',
    'tiny.en',
    'base',
    'base.en',
    'small',
    'small.en',
    'medium',
    'medium.en',
    'large',
    'large-v2',
    'large-v3',
    'large-v3-turbo',
  ];
}

export function getModelUrl(model: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
}
