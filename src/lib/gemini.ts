import { GoogleGenerativeAI, type ResponseSchema } from '@google/generative-ai'
import { env } from '../config/env'

const genAI = new GoogleGenerativeAI(env.geminiApiKey)

const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
const chatModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' })

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
  return genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    systemInstruction,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  })
}
