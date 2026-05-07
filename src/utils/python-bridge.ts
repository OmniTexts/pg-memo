import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts");

export interface PythonExtractionResult {
  content: string;
  metadata: {
    pages: number;
    vlm_enhanced: boolean;
    [key: string]: any;
  };
}

/**
 * Calls the Python PDF extractor script.
 */
export async function runPythonExtractor(
  filePath: string,
  mediaDir?: string,
  baseUrl?: string
): Promise<PythonExtractionResult | null> {
  const scriptPath = path.join(SCRIPTS_DIR, "pdf_extractor.py");
  
  return new Promise((resolve, reject) => {
    const args = [scriptPath, filePath];
    args.push(mediaDir || "None");
    if (baseUrl) args.push(baseUrl);

    const child = spawn("python3", args, {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(`Python extractor exited with code ${code}. Stderr: ${stderr}`);
        return resolve(null); // Fallback to basic reader
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          console.error(`Python extraction error: ${result.error}`);
          return resolve(null);
        }
        resolve(result);
      } catch (e) {
        console.error("Failed to parse Python output as JSON", e, "Raw output:", stdout);
        resolve(null);
      }
    });

    child.on("error", (err) => {
      console.warn("Failed to start Python process. Ensure python3 is installed.", err);
      resolve(null);
    });
  });
}
