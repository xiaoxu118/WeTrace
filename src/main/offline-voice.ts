import { createRequire } from 'node:module'
import path from 'node:path'
import { decode } from 'silk-wasm'

interface Stream { acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void }
interface Recognizer { createStream(): Stream; decodeAsync(stream: Stream): Promise<void>; getResult(stream: Stream): { text: string } }
export async function createOfflineTranscriber(directory: string): Promise<(hex: string) => Promise<string>> {
  const require = createRequire(import.meta.url)
  const sherpa = require('sherpa-onnx-node') as { OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> } }
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { senseVoice: { model: path.join(directory, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 }, tokens: path.join(directory, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 },
    decodingMethod: 'greedy_search',
  })
  return async hex => {
    const pcm = Buffer.from((await decode(Buffer.from(hex, 'hex'), 16000)).data)
    const samples = new Float32Array(pcm.length / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: 16000 })
    await recognizer.decodeAsync(stream)
    const text = recognizer.getResult(stream).text.replace(/<\|[^|]*\|>/g, '').trim()
    if (!text) throw new Error('未识别到有效语音')
    return text
  }
}
