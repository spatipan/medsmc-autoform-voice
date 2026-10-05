// Float32 mic samples (any rate) -> 16 kHz mono 16-bit PCM chunks (little-endian) for the Gemini Live API.
(function (root) {
  'use strict';
  var TARGET_RATE = 16000;

  // onChunk(Int16Array) is called every `chunkSamples` output samples (1600 = 100 ms at 16 kHz).
  function createPcmChunker(chunkSamples, onChunk) {
    var buf = new Int16Array(chunkSamples);
    var n = 0;
    var pos = 0; // fractional read position carried across input blocks
    function emit(s) {
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      buf[n++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      if (n === chunkSamples) { onChunk(buf.slice()); n = 0; }
    }
    return {
      push: function (input, inRate) {
        var ratio = inRate / TARGET_RATE;
        if (ratio === 1) { for (var k = 0; k < input.length; k++) emit(input[k]); return; }
        // Box-filter decimation: average the input samples covered by each output sample.
        while (pos < input.length) {
          var start = Math.floor(pos);
          var end = Math.min(input.length, Math.max(start + 1, Math.floor(pos + ratio)));
          var sum = 0;
          for (var i = start; i < end; i++) sum += input[i];
          emit(sum / (end - start));
          pos += ratio;
        }
        pos -= input.length;
      },
      flush: function () {
        if (n) { var tail = buf.slice(0, n); n = 0; onChunk(tail); }
        pos = 0;
      },
      reset: function () { n = 0; pos = 0; }
    };
  }

  function int16ToBase64(int16) {
    var bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function rms(input) {
    var s = 0;
    for (var i = 0; i < input.length; i++) s += input[i] * input[i];
    return Math.sqrt(s / (input.length || 1));
  }

  function wavFromBase64(chunks) {
    var parts = chunks.map(function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); });
    var length = parts.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(44 + length), view = new DataView(out.buffer);
    function tag(offset, text) { for (var i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i); }
    tag(0, 'RIFF'); view.setUint32(4, 36 + length, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, length, true);
    var offset = 44;
    parts.forEach(function (p) { out.set(p, offset); offset += p.length; });
    return out;
  }

  var api = { TARGET_RATE: TARGET_RATE, createPcmChunker: createPcmChunker, int16ToBase64: int16ToBase64, wavFromBase64: wavFromBase64, rms: rms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pcm = api;
})(typeof self !== 'undefined' ? self : this);
