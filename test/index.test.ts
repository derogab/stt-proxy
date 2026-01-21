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

// Mock global fetch for Cloudflare tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function clearProviderEnvs() {
  delete process.env['WHISPER_CPP_MODEL_PATH'];
  delete process.env['CLOUDFLARE_ACCOUNT_ID'];
  delete process.env['CLOUDFLARE_AUTH_KEY'];
}

describe('stt-proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
    clearProviderEnvs();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });


  describe('transcribe', () => {
    it('should throw error when no provider is configured (string path)', async () => {
      const { transcribe } = await import('../src/index.js');
      clearProviderEnvs();
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'No STT provider configured'
      );
    });

    it('should throw error when no provider is configured (Buffer)', async () => {
      const { transcribe } = await import('../src/index.js');
      clearProviderEnvs();
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

    it('should fall through to next provider when Whisper model file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === '/path/to/audio.wav') return true;
        return false; // Model file doesn't exist
      });
      const { transcribe } = await import('../src/index.js');
      clearProviderEnvs();
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'No STT provider configured'
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

  describe('Cloudflare provider', () => {
    it('should use Cloudflare when configured and Whisper.cpp is not', async () => {
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: { text: 'Cloudflare transcription' },
        }),
      });

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result).toBeDefined();
      expect(result.text).toBe('Cloudflare transcription');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/ai/run/@cf/openai/whisper-large-v3-turbo',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-auth-key',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should throw error when Cloudflare API returns error status', async () => {
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Unauthorized'),
      });

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Cloudflare API error: 401 Unauthorized'
      );
    });

    it('should throw error when Cloudflare API returns unsuccessful response', async () => {
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          errors: [{ message: 'Invalid audio format' }],
        }),
      });

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Cloudflare transcription failed: Invalid audio format'
      );
    });

    it('should throw error when audio file does not exist for Cloudflare', async () => {
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Audio file not found'
      );
    });

    it('should successfully transcribe audio from buffer using Cloudflare', async () => {
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: { text: 'Buffer transcription from Cloudflare' },
        }),
      });

      const { transcribe } = await import('../src/index.js');
      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribe(audioBuffer);

      expect(result).toBeDefined();
      expect(result.text).toBe('Buffer transcription from Cloudflare');
    });
  });

  describe('Provider priority', () => {
    it('should prefer Whisper.cpp over Cloudflare when both are configured', async () => {
      // Configure both providers
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockReturnValue(true);
      const pcmData = new Float32Array([0.1, 0.2, 0.3]);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(pcmData.buffer));

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      // Should use Whisper.cpp (mocked to return "Hello, world!")
      expect(result.text).toBe('Hello, world!');
      // Cloudflare fetch should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fall back to Cloudflare when Whisper.cpp model path is set but file does not exist', async () => {
      // Whisper model path set but file doesn't exist
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/nonexistent/model.bin';
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
      process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === '/path/to/nonexistent/model.bin') return false;
        return true; // Audio file exists
      });
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: { text: 'Cloudflare fallback' },
        }),
      });

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result.text).toBe('Cloudflare fallback');
      expect(mockFetch).toHaveBeenCalled();
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
