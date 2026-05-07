import fs from 'fs';
import path from 'path';
import { FileReader, ChunkConfig, AudioConfig, MediaConfig } from '../types.js';
import { MiMoProvider } from '../providers/mimo.js';

export const audioReader: FileReader = {
  extensions: ['.mp3', '.m4a', '.wav'],

  async read(
    filePath: string,
    workspaceDir: string,
    chunkConfig: ChunkConfig,
    options?: { media?: MediaConfig; audio?: AudioConfig }
  ): Promise<{ content: string; metadata?: Record<string, any> }> {
    const config = options?.audio;
    if (!config || config.provider === 'none') {
      return { content: '' };
    }

    const mimo = new MiMoProvider(config);
    console.log(`[AudioReader] Transcribing: ${path.basename(filePath)}...`);

    // 1. Transcribe via MiMo
    const transcript = await mimo.transcribe(filePath, config.diarization);

    // 2. Save transcript to .transcripts folder
    const transcriptDir = config.rootPath || path.join(path.dirname(filePath), '.transcripts');
    if (!fs.existsSync(transcriptDir)) {
      fs.mkdirSync(transcriptDir, { recursive: true });
    }

    const transcriptName = `${path.basename(filePath, path.extname(filePath))}.md`;
    const transcriptPath = path.join(transcriptDir, transcriptName);
    
    const fullContent = `---
source: ${filePath}
type: audio_transcript
date: ${new Date().toISOString()}
---

${transcript}
`;
    fs.writeFileSync(transcriptPath, fullContent);

    // 3. Return content
    return { 
      content: transcript,
      metadata: { 
        transcriptPath,
        audioPath: filePath,
        speakerSeparated: config.diarization 
      }
    };
  }
};
