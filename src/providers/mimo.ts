import fs from 'fs';
import { AudioConfig } from '../types.js';

export class MiMoProvider {
  private apiKey: string;
  private apiUrl = 'https://api.xiaomimimo.com/v1/chat/completions';

  constructor(config: AudioConfig) {
    if (!config.apiKey) throw new Error('Xiaomi MiMo API Key is required');
    this.apiKey = config.apiKey;
  }

  /**
   * Transcribe audio using MiMo multimodal chat API
   */
  async transcribe(audioPath: string, diarization: boolean = true): Promise<string> {
    const audioBuffer = fs.readFileSync(audioPath);
    const base64Audio = audioBuffer.toString('base64');
    const ext = audioPath.split('.').pop() || 'm4a';

    const prompt = diarization 
      ? "请转录这段音频，并区分不同的说话人（标注为人员1、人员2等）。请保留时间戳，并以Markdown格式返回。" 
      : "请转录这段音频，保留时间戳，并以Markdown格式返回。";

    const payload = {
      model: "mimo-v2.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: ext
              }
            }
          ]
        }
      ]
    };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiMo API Error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as any;
    return result.choices[0].message.content;
  }
}
