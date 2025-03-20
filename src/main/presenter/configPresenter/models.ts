export const defaultModelsSettings = [
  // Gemini 系列模型
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 1048576,
    match: ['gemini-2.0-flash'],
    vision: true
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 1048576,
    match: ['gemini-1.5-flash'],
    vision: true
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 2097152,
    match: ['gemini-1.5-pro'],
    vision: true
  },
  // DeepSeek系列模型配置
  {
    id: 'deepseek-vl2',
    name: 'DeepSeek VL2',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 4096,
    match: ['deepseek-vl2'],
    vision: true
  },
  {
    id: 'deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill Qwen 32B',
    temperature: 0.7,
    maxTokens: 16384,
    contextLength: 32768,
    match: ['deepseek-r1-distill-qwen-32b'],
    vision: false
  },
  {
    id: 'deepseek-r1-distill-qwen-14b',
    name: 'DeepSeek R1 Distill Qwen 14B',
    temperature: 0.7,
    maxTokens: 16384,
    contextLength: 32768,
    match: ['deepseek-r1-distill-qwen-14b'],
    vision: false
  },
  {
    id: 'deepseek-r1-distill-qwen-7b',
    name: 'DeepSeek R1 Distill Qwen 7B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['deepseek-r1-distill-qwen-7b'],
    vision: false
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b',
    name: 'DeepSeek R1 Distill Qwen 1.5B',
    temperature: 0.6,
    maxTokens: 32768,
    contextLength: 131072,
    match: ['deepseek-r1-distill-qwen-1.5b', 'deepseek-r1-distill-qwen-1-5b'],
    vision: false
  },
  {
    id: 'deepseek-r1-distill-llama-8b',
    name: 'DeepSeek R1 Distill Llama 8B',
    temperature: 0.6,
    maxTokens: 32768,
    contextLength: 131072,
    match: ['deepseek-r1-distill-llama-8b'],
    vision: false
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill Llama 70B',
    temperature: 0.6,
    maxTokens: 32768,
    contextLength: 65536,
    match: ['deepseek-r1-distill-llama-70b'],
    vision: false
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    temperature: 0.6,
    maxTokens: 32768,
    contextLength: 65536,
    match: ['deepseek-r1', 'deepseek-r1-zero'],
    vision: false
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    temperature: 0.6,
    maxTokens: 8192,
    contextLength: 65536,
    match: ['deepseek-reasoner'],
    vision: false
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek chat',
    temperature: 0.6,
    maxTokens: 8192,
    contextLength: 65536,
    match: ['deepseek-chat'],
    vision: false
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    temperature: 0.6,
    maxTokens: 8192,
    contextLength: 65536,
    match: ['deepseek-v3'],
    vision: false
  },
  {
    id: 'deepseek-v2.5',
    name: 'DeepSeek V2.5',
    temperature: 0.6,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['deepseek-v2.5', 'deepseek-v2-5'],
    vision: false
  },

  // Claude系列模型配置
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    temperature: 0.7,
    maxTokens: 64000,
    contextLength: 65536,
    match: ['claude-3-7-sonnet', 'claude-3.7-sonnet'],
    vision: true
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 65536,
    match: ['claude-3-5-sonnet', 'claude-3.5-sonnet'],
    vision: true
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 65536,
    match: ['claude-3-opus', 'claude-3.opus'],
    vision: true
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 65536,
    match: ['claude-3-haiku', 'claude-3.haiku', 'claude-3-5-haiku', 'claude-3.5-haiku'],
    vision: true
  },

  // OpenAI GPT系列模型配置
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['gpt-4o'],
    vision: true
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['gpt-4-turbo', 'gpt-4-1106'],
    vision: true
  },
  {
    id: 'gpt-4-32k',
    name: 'GPT-4 32K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['gpt-4-32k'],
    vision: false
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
    match: ['gpt-4-0'],
    vision: false
  },
  {
    id: 'gpt-3.5-turbo-16k',
    name: 'GPT-3.5 Turbo 16K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['gpt-3.5-turbo-16k', 'gpt-3-5-turbo-16k'],
    vision: false
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 4096,
    match: ['gpt-3.5-turbo', 'gpt-3-5-turbo'],
    vision: false
  },
  {
    id: 'o1-preview',
    name: 'Claude Opus 1 Preview',
    temperature: 0.7,
    maxTokens: 32768,
    contextLength: 128000,
    match: ['o1-preview'],
    vision: true
  },
  {
    id: 'o1-mini',
    name: 'Claude Opus 1 Mini',
    temperature: 0.7,
    maxTokens: 65536,
    contextLength: 128000,
    match: ['o1-mini'],
    vision: true
  },

  // Llama系列
  {
    id: 'llama-3.1-405b',
    name: 'Llama 3.1 405B',
    temperature: 0.7,
    maxTokens: 32768,
    contextLength: 128000,
    match: ['llama-3.1-405b', 'llama-3.1-405-b', 'llama-3.1-405'],
    vision: false
  },
  {
    id: 'llama-3.1-70b',
    name: 'Llama 3.1 70B',
    temperature: 0.7,
    maxTokens: 16384,
    contextLength: 128000,
    match: ['llama-3.1-70b', 'llama-3.1-70-b', 'llama-3.1-70'],
    vision: false
  },
  {
    id: 'llama-3-70b',
    name: 'Llama 3 70B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['llama-3-70b', 'llama-3-70-b', 'llama-3-70'],
    vision: false
  },
  {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['llama-3.1-8b', 'llama-3.1-8-b'],
    vision: false
  },
  {
    id: 'llama-3-8b',
    name: 'Llama 3 8B',
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 8192,
    match: ['llama-3-8b', 'llama-3-8-b'],
    vision: false
  },
  {
    id: 'llama-2-70b',
    name: 'Llama 2 70B',
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 4096,
    match: ['llama-2-70b'],
    vision: false
  },
  {
    id: 'llama-2',
    name: 'Llama 2',
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 4096,
    match: ['llama-2-'],
    vision: false
  },

  // Mistral系列
  {
    id: 'mistral-large-2',
    name: 'Mistral Large 2',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['mistral-large-2'],
    vision: false
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['mistral-large'],
    vision: false
  },
  {
    id: 'mistral-8x7b',
    name: 'Mistral 8x7B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['mistral-8x7b', 'mixtral-8x7b'],
    vision: false
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
    match: ['mistral-7b'],
    vision: false
  },

  // Qwen系列
  {
    id: 'QVQ-72B-Preview',
    name: 'QVQ-72B-Preview',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['QVQ-72B-Preview'],
    vision: true
  },
  {
    id: 'Qwen2-VL-72B-Instruct',
    name: 'Qwen2-VL-72B-Instruct',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['Qwen2-VL-72B-Instruct'],
    vision: true
  },

  {
    id: 'qwen2.5-72b',
    name: 'Qwen 2.5 72B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 131072,
    match: ['qwen2.5-72b', 'qwen-2.5-72b'],
    vision: false
  },
  {
    id: 'qwen2.5-32b',
    name: 'Qwen 2.5 32B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 131072,
    match: ['qwen2.5-32b', 'qwen-2.5-32b'],
    vision: false
  },
  {
    id: 'qwen2.5-14b',
    name: 'Qwen 2.5 14B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 131072,
    match: ['qwen2.5-14b', 'qwen-2.5-14b'],
    vision: false
  },
  {
    id: 'qwen2.5-7b',
    name: 'Qwen 2.5 7B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 131072,
    match: ['qwen2.5-7b', 'qwen-2.5-7b'],
    vision: false
  },
  {
    id: 'qwen2.5',
    name: 'Qwen 2.5',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['qwen2.5-', 'qwen-2.5-'],
    vision: false
  },
  {
    id: 'qwen',
    name: 'Qwen',
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 32768,
    match: ['qwen-'],
    vision: false
  },

  // Yi系列
  {
    id: 'yi-34b',
    name: 'Yi 34B',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['yi-34b'],
    vision: false
  },
  {
    id: 'yi',
    name: 'Yi',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['yi-'],
    vision: false
  },

  // Gemma系列
  {
    id: 'gemma-2-27b',
    name: 'Gemma 2 27B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['gemma-2-27b'],
    vision: false
  },
  {
    id: 'gemma-2-9b',
    name: 'Gemma 2 9B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['gemma-2-9b'],
    vision: false
  },
  {
    id: 'gemma-2-2b',
    name: 'Gemma 2 2B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['gemma-2-2b'],
    vision: false
  },
  {
    id: 'gemma-7b',
    name: 'Gemma 7B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['gemma-7b'],
    vision: false
  },
  {
    id: 'gemma-2b',
    name: 'Gemma 2B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['gemma-2b'],
    vision: false
  },

  // Phi系列
  {
    id: 'phi-4',
    name: 'Phi-4',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['phi-4-', 'phi4-', 'phi4'],
    vision: false
  },
  {
    id: 'phi-3',
    name: 'Phi-3',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['phi-3-', 'phi3-', 'phi3'],
    vision: false
  },

  // Ollama平台模型配置
  {
    id: 'ollama',
    name: 'Ollama',
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 2048,
    match: ['ollama'],
    vision: false
  },

  // Doubao (字节跳动)模型配置
  {
    id: 'doubao-1.5-pro-256k',
    name: 'Doubao 1.5 Pro 256K',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 262144,
    match: ['doubao-1.5-pro-256k'],
    vision: false
  },
  {
    id: 'doubao-1.5-vision-pro-32k',
    name: 'Doubao 1.5 Vision Pro 32K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['doubao-1.5-vision-pro-32k'],
    vision: true
  },
  {
    id: 'doubao-1.5-pro-32k',
    name: 'Doubao 1.5 Pro 32K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['doubao-1.5-pro-32k'],
    vision: false
  },
  {
    id: 'doubao',
    name: 'Doubao',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['doubao'],
    vision: false
  },

  // MiniMax模型配置
  {
    id: 'minimax-01',
    name: 'MiniMax 01',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 1048576,
    match: ['minimax-01', 'minimax/minimax-01', 'minimax-text-01'],
    vision: false
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4 Plus',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 1048576,
    match: ['glm-4-plus', 'glm-4-air'],
    vision: false
  },
  {
    id: 'step-2-16k',
    name: 'Step-2 16K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['step-2-16k-exp', 'step-2-16k'],
    vision: false
  },
  {
    id: 'step-2-mini',
    name: 'Step-2 Mini',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['step-2-mini'],
    vision: false
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['minimax'],
    vision: false
  },

  // Fireworks AI模型配置
  {
    id: 'fireworks-llama-3.1-405b',
    name: 'Fireworks Llama 3.1 405B',
    temperature: 0.7,
    maxTokens: 32768,
    contextLength: 128000,
    match: ['fireworks', 'llama-3.1-405b', 'llama-3.1-405-b'],
    vision: false
  },
  {
    id: 'fireworks-llama-3.1-70b',
    name: 'Fireworks Llama 3.1 70B',
    temperature: 0.7,
    maxTokens: 16384,
    contextLength: 128000,
    match: ['fireworks', 'llama-3.1-70b', 'llama-3.1-70-b'],
    vision: false
  },
  {
    id: 'fireworks-llama-3.1-8b',
    name: 'Fireworks Llama 3.1 8B',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 8192,
    match: ['fireworks', 'llama-3.1-8b', 'llama-3.1-8-b'],
    vision: false
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['fireworks', 'accounts/fireworks/'],
    vision: false
  },

  // PPIO AI模型配置
  {
    id: 'ppio',
    name: 'PPIO',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['ppio'],
    vision: false
  },

  // Moonshot (月之暗面)模型配置
  {
    id: 'moonshot-v1-8k',
    name: 'Moonshot V1 8K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
    match: ['moonshot-v1-8k', 'moonshot/moonshot-v1-8k'],
    vision: false
  },
  {
    id: 'moonshot-v1-32k',
    name: 'Moonshot V1 32K',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['moonshot-v1-32k', 'moonshot/moonshot-v1-32k'],
    vision: false
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot V1 128K',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 131072,
    match: ['moonshot-v1-128k', 'moonshot/moonshot-v1-128k'],
    vision: false
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['moonshot'],
    vision: false
  },

  // OpenRouter配置
  {
    id: 'openrouter',
    name: 'OpenRouter',
    temperature: 0.7,
    maxTokens: 8192,
    contextLength: 32768,
    match: ['openrouter', 'openrouter/'],
    vision: false
  },

  // GitHub Copilot配置
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
    match: ['github-copilot', 'copilot'],
    vision: false
  },

  // Azure OpenAI配置
  {
    id: 'azure-openai-gpt-4o',
    name: 'Azure OpenAI GPT-4o',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['azure-openai', 'azure/openai', 'gpt-4o'],
    vision: true
  },
  {
    id: 'azure-openai-gpt-4-turbo',
    name: 'Azure OpenAI GPT-4 Turbo',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 128000,
    match: ['azure-openai', 'azure/openai', 'gpt-4-turbo', 'gpt-4-1106'],
    vision: true
  },
  {
    id: 'azure-openai-gpt-4-32k',
    name: 'Azure OpenAI GPT-4 32K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 32768,
    match: ['azure-openai', 'azure/openai', 'gpt-4-32k'],
    vision: false
  },
  {
    id: 'azure-openai-gpt-4',
    name: 'Azure OpenAI GPT-4',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
    match: ['azure-openai', 'azure/openai', 'gpt-4'],
    vision: false
  },
  {
    id: 'azure-openai-gpt-3.5-turbo-16k',
    name: 'Azure OpenAI GPT-3.5 Turbo 16K',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['azure-openai', 'azure/openai', 'gpt-3.5-turbo-16k'],
    vision: false
  },
  {
    id: 'azure-openai-gpt-3.5-turbo',
    name: 'Azure OpenAI GPT-3.5 Turbo',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 4096,
    match: ['azure-openai', 'azure/openai', 'gpt-3.5-turbo'],
    vision: false
  },

  // Silicon (硅基智能)模型配置
  {
    id: 'silicon',
    name: 'Silicon',
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 16384,
    match: ['silicon'],
    vision: false
  }
]
