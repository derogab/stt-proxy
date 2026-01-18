import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('smart-whisper', () => ({
  Whisper: vi.fn().mockImplementation(() => ({
    transcribe: vi.fn().mockResolvedValue({
      result: Promise.resolve([{ text: 'Hello, world!', from: 0, to: 1000 }]),
    }),
    free: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('stt-proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['WHISPER_CPP_MODEL_PATH'];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('isWhisperConfigured', () => {
    it('should return false when WHISPER_CPP_MODEL_PATH is not set', async () => {
      const { isWhisperConfigured } = await import('../src/index.js');
      expect(isWhisperConfigured()).toBe(false);
    });

    it('should return false when WHISPER_CPP_MODEL_PATH is set but file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const { isWhisperConfigured } = await import('../src/index.js');
      expect(isWhisperConfigured()).toBe(false);
    });

    it('should return true when WHISPER_CPP_MODEL_PATH is set and file exists', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const { isWhisperConfigured } = await import('../src/index.js');
      expect(isWhisperConfigured()).toBe(true);
    });
  });

  describe('transcribe', () => {
    it('should throw error when no provider is configured', async () => {
      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'No STT provider configured'
      );
    });

    it('should throw error when audio file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === '/path/to/model.bin') return true;
        return false;
      });
      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Audio file not found'
      );
    });

    it('should throw error when model file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === '/path/to/audio.wav') return true;
        return false;
      });
      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Whisper model not found at path'
      );
    });
  });

  describe('getAvailableModels', () => {
    it('should return list of available models', async () => {
      const { getAvailableModels } = await import('../src/index.js');
      const models = getAvailableModels();
      expect(models).toContain('tiny');
      expect(models).toContain('base');
      expect(models).toContain('small');
      expect(models).toContain('medium');
      expect(models).toContain('large');
      expect(models).toContain('large-v3-turbo');
      expect(models.length).toBe(12);
    });
  });

  describe('getModelUrl', () => {
    it('should return correct HuggingFace URL for model', async () => {
      const { getModelUrl } = await import('../src/index.js');
      const url = getModelUrl('base');
      expect(url).toBe('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin');
    });

    it('should return correct URL for large-v3-turbo model', async () => {
      const { getModelUrl } = await import('../src/index.js');
      const url = getModelUrl('large-v3-turbo');
      expect(url).toBe('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin');
    });
  });

  describe('freeWhisper', () => {
    it('should not throw when called without active instance', async () => {
      const { freeWhisper } = await import('../src/index.js');
      await expect(freeWhisper()).resolves.not.toThrow();
    });
  });

  describe('transcribeBuffer', () => {
    it('should throw error when no provider is configured', async () => {
      const { transcribeBuffer } = await import('../src/index.js');
      const buffer = Buffer.from('test');
      await expect(transcribeBuffer(buffer)).rejects.toThrow(
        'No STT provider configured'
      );
    });
  });

  describe('type exports', () => {
    it('should export transcribe function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.transcribe).toBe('function');
    });

    it('should export transcribeBuffer function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.transcribeBuffer).toBe('function');
    });

    it('should export isWhisperConfigured function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.isWhisperConfigured).toBe('function');
    });

    it('should export freeWhisper function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.freeWhisper).toBe('function');
    });

    it('should export getAvailableModels function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.getAvailableModels).toBe('function');
    });

    it('should export getModelUrl function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.getModelUrl).toBe('function');
    });
  });
});
