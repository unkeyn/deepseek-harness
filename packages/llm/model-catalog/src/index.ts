import { Context, Service } from '@deepseek-ai/cordis'
import MODELS from '@oh-my-pi/pi-catalog/models.json' with { type: 'json' }

type RawModel = {
  id: string
  name?: string
  input?: readonly string[]
  reasoning?: boolean
  thinking?: { mode: string; efforts?: readonly string[] }
  contextWindow?: number | null
  maxTokens?: number | null
}

/** Capability fields projected from the generated external model catalog. */
export interface ModelCapabilityReference {
  readonly id: string
  readonly name: string
  readonly input: readonly string[]
  readonly reasoning: boolean
  readonly thinking?: { mode: string; efforts: readonly string[] }
  readonly contextWindow?: number
  readonly maxTokens?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { modelCatalog: ModelCatalog }
}

/** One shared, immutable model-reference catalog for all LLM consumers. */
export class ModelCatalog extends Service {
  private readonly references = this.buildReferences()

  constructor(ctx: Context) { super(ctx, 'modelCatalog') }

  /** Resolve a configured model id to capability metadata without provider guesses. */
  resolve(modelId: string): ModelCapabilityReference | undefined {
    const candidates = [modelId, modelId.slice(modelId.lastIndexOf('/') + 1)]
    for (const candidate of candidates) {
      const reference = this.references.get(candidate.toLowerCase())
      if (reference !== undefined) return reference
    }
    return undefined
  }

  private buildReferences(): Map<string, ModelCapabilityReference> {
    const result = new Map<string, ModelCapabilityReference>()
    for (const provider of Object.values(MODELS) as Record<string, RawModel>[]) {
      for (const model of Object.values(provider)) {
        const key = model.id.toLowerCase()
        const reference: ModelCapabilityReference = {
          id: model.id,
          name: model.name ?? model.id,
          input: [...model.input ?? ['text']],
          reasoning: model.reasoning === true,
          ...model.thinking === undefined ? {} : {
            thinking: {
              mode: model.thinking.mode,
              efforts: [...model.thinking.efforts ?? []],
            },
          },
          ...model.contextWindow == null ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens == null ? {} : { maxTokens: model.maxTokens },
        }
        const current = result.get(key)
        if (current === undefined || compareReferences(reference, current) > 0) result.set(key, reference)
      }
    }
    return result
  }
}

function compareReferences(left: ModelCapabilityReference, right: ModelCapabilityReference): number {
  const leftRank = [
    left.input.includes('image') ? 1 : 0,
    left.reasoning ? 1 : 0,
    left.thinking?.efforts.length ?? 0,
    left.contextWindow ?? 0,
    left.maxTokens ?? 0,
  ]
  const rightRank = [
    right.input.includes('image') ? 1 : 0,
    right.reasoning ? 1 : 0,
    right.thinking?.efforts.length ?? 0,
    right.contextWindow ?? 0,
    right.maxTokens ?? 0,
  ]
  for (let index = 0; index < leftRank.length; index += 1) {
    const left = leftRank[index]
    const right = rightRank[index]
    if (left !== right) return (left ?? 0) - (right ?? 0)
  }
  return right.id.localeCompare(left.id)
}

export default ModelCatalog
