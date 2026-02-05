# stt-proxy
A simple and lightweight proxy for seamless integration with multiple STT providers including Whisper.cpp and Cloudflare AI.

> **Proxy Collection**: This package is part of a plug-and-play proxy collection designed for easy integration into your projects:
> - [`@derogab/llm-proxy`](https://github.com/derogab/llm-proxy) - LLM provider proxy
> - [`@derogab/stt-proxy`](https://github.com/derogab/stt-proxy) - Speech-to-Text provider proxy (this package)

## Features

- **Multi-provider support**: Switch between STT providers with environment variables.
- **TypeScript support**: Full TypeScript definitions included.
- **Simple API**: Single function interface for all providers.
- **Automatic provider detection**: Automatically selects the best available provider based on environment variables.

## Installation

```bash
npm install @derogab/stt-proxy
```

## Quick Start

```typescript
import { transcribe } from '@derogab/stt-proxy';

const result = await transcribe('/path/to/audio.wav');
console.log(result.text);
```

## Configuration

The package automatically detects which STT provider to use based on your environment variables.
Configure one or more providers:

### Provider Selection
```bash
STT_PROVIDER=cloudflare # Optional, force a specific provider (whisper.cpp, cloudflare)
```

When `STT_PROVIDER` is set, the specified provider will be used and an error is thrown if its credentials are not configured. When not set, providers are selected automatically based on priority.

> **Note:** `PROVIDER` is supported as a fallback for backward compatibility when `STT_PROVIDER` is not set.

### Whisper.cpp (Local)
```bash
WHISPER_CPP_MODEL_PATH=/path/to/ggml-base.bin # Required, path to your GGML model file
```

Download models from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp/tree/main):
```bash
curl -L -o ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

### Cloudflare AI
```bash
CLOUDFLARE_ACCOUNT_ID=your-account-id # Required
CLOUDFLARE_AUTH_KEY=your-api-token    # Required
```

Uses the `@cf/openai/whisper-large-v3-turbo` model.

## API Reference

### `transcribe(audio: string | Buffer, options?): Promise<TranscribeOutput>`

Transcribes audio to text using the configured STT provider. The package automatically manages provider initialization and cleanup.

**Parameters:**
- `audio`: Path to audio file (string) or audio Buffer
- `options` (optional): Transcription options

**Returns:**
- Promise that resolves to an object with `text` property

**Options Format:**
```typescript
type TranscribeOptions = {
  language?: string;   // Language code (e.g., 'en', 'es', 'fr')
  translate?: boolean; // Translate to English
};
```

**Output Format:**
```typescript
type TranscribeOutput = {
  text: string;
};
```

**Example:**
```typescript
// Transcribe from file path
const result1 = await transcribe('/path/to/audio.wav');
console.log(result1.text);

// Transcribe from Buffer
const audioBuffer = fs.readFileSync('/path/to/audio.wav');
const result2 = await transcribe(audioBuffer);
console.log(result2.text);

// With options
const result3 = await transcribe('/path/to/audio.wav', {
  language: 'en',
  translate: false
});
console.log(result3.text);
```

## Provider Priority

When `STT_PROVIDER` environment variable is set, that provider is used directly.

Otherwise, the package selects providers in the following order:
1. **Whisper.cpp** (if `WHISPER_CPP_MODEL_PATH` is set and file exists)
2. **Cloudflare AI** (if `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_KEY` are set)

If no providers are configured, the function throws an error.

## Requirements

- **FFmpeg**: Required for audio conversion (Whisper.cpp only).
  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt install ffmpeg

  # Windows (with Chocolatey)
  choco install ffmpeg
  ```

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Run tests
npm test
```

## Credits
_STT Proxy_ is made with ♥ by [derogab](https://github.com/derogab) and it's released under the [MIT license](./LICENSE).

## Contributors

<a href="https://github.com/derogab/stt-proxy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=derogab/stt-proxy" />
</a>

## Tip
If you like this project or directly benefit from it, please consider buying me a coffee:  
🔗 `bc1qd0qatgz8h62uvnr74utwncc6j5ckfz2v2g4lef`  
⚡️ `derogab@sats.mobi`  
💶 [Sponsor on GitHub](https://github.com/sponsors/derogab)

## Stargazers over time
[![Stargazers over time](https://starchart.cc/derogab/stt-proxy.svg?variant=adaptive)](https://starchart.cc/derogab/stt-proxy)