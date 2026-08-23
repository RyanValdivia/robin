// Embeddings 100% local (sin API paga) via transformers.js + ONNX runtime.
// Modelo multilingüe (soporta español) — dimensión 384, ver db/schema.sql.
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_DIM = 384;
const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/** Vector de 384 floats para un texto. Corre local, primera llamada descarga el modelo (~cientos de MB, una sola vez, cacheado). */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
