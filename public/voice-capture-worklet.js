// Voice mode microphone capture (lib/voice-call.ts). Batches the mic's
// 128-frame render quanta into ~40 ms chunks and posts them to the main
// thread, which resamples to 24 kHz PCM16 and streams them to AI Gateway.
// Served from /public so the page CSP's script-src 'self' allows it.
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.04);
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.size - this.filled);
      this.buffer.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === this.size) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
