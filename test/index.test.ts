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

// Helper functions
function clearProviderEnvs() {
  delete process.env['PROVIDER'];
  delete process.env['WHISPER_CPP_MODEL_PATH'];
  delete process.env['CLOUDFLARE_ACCOUNT_ID'];
  delete process.env['CLOUDFLARE_AUTH_KEY'];
}

function setCloudflareEnvs() {
  process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-id';
  process.env['CLOUDFLARE_AUTH_KEY'] = 'test-auth-key';
}

function mockCloudflareSuccess(text: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      result: { text },
    }),
  });
}

function setupWhisperMocks() {
  process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
  vi.mocked(fs.existsSync).mockReturnValue(true);
  const pcmData = new Float32Array([0.1, 0.2, 0.3]);
  vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(pcmData.buffer));
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

  describe('No provider', () => {
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
  });

  describe('Whisper.cpp provider', () => {
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

    it('should fall through to next provider when model file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/model.bin';
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'No STT provider configured'
      );
    });

    it('should successfully transcribe audio file', async () => {
      setupWhisperMocks();
      const { transcribe } = await import('../src/index.js');

      const result = await transcribe('/path/to/audio.wav');

      expect(result).toBeDefined();
      expect(result.text).toBe('Hello, world!');
    });

    it('should successfully transcribe audio from buffer', async () => {
      setupWhisperMocks();
      const { transcribe } = await import('../src/index.js');

      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribe(audioBuffer);

      expect(result).toBeDefined();
      expect(result.text).toBe('Hello, world!');
    });
  });

  describe('Cloudflare provider', () => {
    it('should use Cloudflare when configured and Whisper.cpp is not', async () => {
      setCloudflareEnvs();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));
      mockCloudflareSuccess('Cloudflare transcription');

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
      setCloudflareEnvs();
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
      setCloudflareEnvs();
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
      setCloudflareEnvs();
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Audio file not found'
      );
    });

    it('should successfully transcribe audio from buffer using Cloudflare', async () => {
      setCloudflareEnvs();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));
      mockCloudflareSuccess('Buffer transcription from Cloudflare');

      const { transcribe } = await import('../src/index.js');
      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribe(audioBuffer);

      expect(result).toBeDefined();
      expect(result.text).toBe('Buffer transcription from Cloudflare');
    });
  });

  describe('Provider priority', () => {
    it('should prefer Whisper.cpp over Cloudflare when both are configured', async () => {
      setupWhisperMocks();
      setCloudflareEnvs();

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      // Should use Whisper.cpp (mocked to return "Hello, world!")
      expect(result.text).toBe('Hello, world!');
      // Cloudflare fetch should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fall back to Cloudflare when Whisper.cpp model path is set but file does not exist', async () => {
      process.env['WHISPER_CPP_MODEL_PATH'] = '/path/to/nonexistent/model.bin';
      setCloudflareEnvs();
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === '/path/to/nonexistent/model.bin') return false;
        return true; // Audio file exists
      });
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));
      mockCloudflareSuccess('Cloudflare fallback');

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result.text).toBe('Cloudflare fallback');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Explicit PROVIDER selection', () => {
    it('should use whisper.cpp when PROVIDER is set to whisper.cpp', async () => {
      process.env['PROVIDER'] = 'whisper.cpp';
      setupWhisperMocks();
      setCloudflareEnvs();

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result.text).toBe('Hello, world!');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should use cloudflare when PROVIDER is set to cloudflare', async () => {
      process.env['PROVIDER'] = 'cloudflare';
      setupWhisperMocks();
      setCloudflareEnvs();
      mockCloudflareSuccess('Cloudflare explicit');

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result.text).toBe('Cloudflare explicit');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should be case-insensitive for PROVIDER value', async () => {
      process.env['PROVIDER'] = 'CLOUDFLARE';
      setCloudflareEnvs();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake audio data'));
      mockCloudflareSuccess('Case insensitive');

      const { transcribe } = await import('../src/index.js');
      const result = await transcribe('/path/to/audio.wav');

      expect(result.text).toBe('Case insensitive');
    });

    it('should throw error when PROVIDER is whisper.cpp but not configured', async () => {
      clearProviderEnvs();
      process.env['PROVIDER'] = 'whisper.cpp';

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        "PROVIDER is set to 'whisper.cpp' but WHISPER_CPP_MODEL_PATH is not configured"
      );
    });

    it('should throw error when PROVIDER is cloudflare but not configured', async () => {
      clearProviderEnvs();
      process.env['PROVIDER'] = 'cloudflare';

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        "PROVIDER is set to 'cloudflare' but CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_KEY are not configured"
      );
    });

    it('should throw error for unknown provider', async () => {
      process.env['PROVIDER'] = 'unknown';

      const { transcribe } = await import('../src/index.js');
      await expect(transcribe('/path/to/audio.wav')).rejects.toThrow(
        'Unknown provider: unknown. Valid providers are: whisper.cpp, cloudflare'
      );
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
