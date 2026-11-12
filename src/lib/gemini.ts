import { GoogleGenerativeAI, type ResponseSchema } from '@google/generative-ai'
import { env } from '../config/env'

const genAI = new GoogleGenerativeAI(env.geminiApiKey)

const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
const REQUEST_TIMEOUT_MS = 15000
const CHAT_MODEL = 'gemini-3.1-flash-lite'

const chatModel = genAI.getGenerativeModel({ model: CHAT_MODEL }, { timeout: REQUEST_TIMEOUT_MS })

export async function embedText(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { role: 'user', parts: [{ text }] },
    outputDimensionality: 768,
  } as Parameters<typeof embeddingModel.embedContent>[0])
  return result.embedding.values
}

export async function generateChatResponse(prompt: string): Promise<string> {
  const result = await chatModel.generateContent(prompt)
  return result.response.text()
}

export function createJsonModel(systemInstruction: string, schema: ResponseSchema) {
  return genAI.getGenerativeModel(
    {
      model: CHAT_MODEL,
      systemInstruction,
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    },
    { timeout: REQUEST_TIMEOUT_MS },
  )
}
