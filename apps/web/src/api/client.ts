const API_URL = import.meta.env.VITE_API_URL || '';

export type CollectionName =
  | 'journal'
  | 'gym'
  | 'finance'
  | 'todo'
  | 'finance_categories'
  | 'finance_businesses'
  | 'gym_exercises';

export interface EntryPage {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface HistoryItem {
  _id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

export const getEntries = async (
  collection: CollectionName,
  token: string,
  page = 1,
  limit = 50,
  filter?: Record<string, unknown>
): Promise<EntryPage> => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (filter) {
    params.set('filter', JSON.stringify(filter));
  }
  const res = await fetch(`${API_URL}/api/entries/${collection}?${params.toString()}`, {
    headers: { Authorization: `Basic ${token}` },
  });
  if (!res.ok) throw new Error('API Error');
  return res.json();
};

export const getHistory = async (
  token: string,
  cursor?: string,
  limit = 30
): Promise<HistoryPage> => {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`${API_URL}/api/history?${params.toString()}`, {
    headers: { Authorization: `Basic ${token}` },
  });
  if (!res.ok) throw new Error('API Error');
  return res.json();
};

export const updateEntry = async (
  collection: CollectionName,
  id: string,
  data: Record<string, unknown>,
  token: string
): Promise<void> => {
  const res = await fetch(`${API_URL}/api/entries/${collection}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('API Error');
};

export const deleteEntry = async (
  collection: CollectionName,
  id: string,
  token: string
): Promise<void> => {
  const res = await fetch(`${API_URL}/api/entries/${collection}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${token}` },
  });
  if (!res.ok) throw new Error('API Error');
};

export const deleteHistoryMessage = async (id: string, token: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/history/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${token}` },
  });
  if (!res.ok) throw new Error('API Error');
};

export interface StructuredResponse {
  text: string;
  code?: string;
}

export const sendChat = async (message: string, token: string): Promise<StructuredResponse> => {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${token}`
    },
    body: JSON.stringify({ message })
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized');
    throw new Error('API Error');
  }

  const data = await res.json();
  return data.response;
};

export interface MemoryInfo {
  summary: string;
  keyPoints: string[];
  lastUpdated?: string;
}

export const getMemoryInfo = async (token: string): Promise<MemoryInfo> => {
  const res = await fetch(`${API_URL}/api/memory`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${token}`
    }
  });

  if (!res.ok) return { summary: '', keyPoints: [] };
  return res.json();
};

export const updateMemoryInfo = async (data: Partial<MemoryInfo>, token: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/memory`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Basic ${token}` 
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('API Error');
};

export const getStructuredMemory = async (token: string): Promise<any> => {
  const res = await fetch(`${API_URL}/api/structured-memory`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${token}`
    }
  });
  if (!res.ok) throw new Error('API Error');
  return res.json();
};

export const updateStructuredMemory = async (data: any, token: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/structured-memory`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Basic ${token}` 
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('API Error');
};

export const getSettings = async (token: string): Promise<{ preferredModel: string }> => {
  const res = await fetch(`${API_URL}/api/settings`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${token}`
    }
  });
  if (!res.ok) throw new Error('API Error');
  return await res.json();
};

export const updateSettings = async (preferredModel: string, token: string): Promise<void> => {
  const res = await fetch(`${API_URL}/api/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${token}`
    },
    body: JSON.stringify({ preferredModel })
  });
  if (!res.ok) throw new Error('API Error');
};

export interface WeatherData {
  temp: number;
  windSpeed: number;
  conditionCode: number;
  isDay: boolean;
  time: string;
  description: string;
  forecast?: {
    maxTemp: number;
    maxTempTime: string;
    minTemp: number;
    minTempTime: string;
  };
}

export const getWeather = async (token: string): Promise<WeatherData | null> => {
  try {
    const res = await fetch(`${API_URL}/api/weather`, {
      headers: { 'Authorization': `Basic ${token}` }
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
};
