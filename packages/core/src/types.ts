export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface N8NPayload {
  action: string;
  data: Record<string, any>;
}

export interface DynamicMemory {
  summary: string;
  keyPoints: string[];
  lastUpdated: Date;
}

export interface StructuredMemory {
  preferences: Record<string, any>;
  userProfile: {
    profession?: string;
    goals?: string[];
  };
  business: {
    income_sources?: string[];
    pricing?: Record<string, number>;
  };
  facts: Record<string, any>;
  lastUpdated: Date;
}

export interface MemoryDocument {
  userId: string;
  dynamicMemory: DynamicMemory | string; // Compatibility with legacy string
  preferredModel: string;
  lastUpdated: Date;
}

export interface StructuredMemoryDocument {
  userId: string;
  memory: StructuredMemory;
  lastUpdated: Date;
}
