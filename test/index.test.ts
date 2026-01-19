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


  describe('transcribe', () => {
    it('should throw error when no provider is configured (string path)', async () => {
      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'No STT provider configured'
      );
    });

    it('should throw error when no provider is configured (Buffer)', async () => {
      const { transcribe } = await import('../src/index.js');
      const buffer = Buffer.from('test');
      await expect(transcribe(buffer)).rejects.toThrow(
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

    it('should successfully transcribe audio file', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // Mock readFileSync to return a valid PCM buffer (Float32Array requires 4-byte aligned buffer)
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(pcmData.buffer));
      const { transcribe } = await import('../src/index.js');

      const result = await transcribe('/path/to/audio.wav');

      expect(result).toBeDefined();
      expect(result.text).toBe('Hello, world!');
    });

    it('should successfully transcribe audio from buffer', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // Mock readFileSync to return a valid PCM buffer (Float32Array requires 4-byte aligned buffer)
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(pcmData.buffer));
      const { transcribe } = await import('../src/index.js');

      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribe(audioBuffer);

      expect(result).toBeDefined();
      expect(result.text).toBe('Hello, world!');
    });
  });


  describe('API exports', () => {
    it('should export transcribe function', async () => {
      const module = await import('../src/index.js');
      expect(typeof module.transcribe).toBe('function');
    });

    it('should only export transcribe function (no other functions)', async () => {
      const module = await import('../src/index.js');
      const exportedFunctions = Object.keys(module).filter(
        key => typeof module[key as keyof typeof module] === 'function'
      );
      expect(exportedFunctions).toEqual(['transcribe']);
    });
  });
});
