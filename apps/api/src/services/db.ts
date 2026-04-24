import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local'), override: true });

const url = process.env.MONGO_URI || 'mongodb://localhost:27017';
const client = new MongoClient(url);

let db: Db;

export const connectDB = async () => {
  await client.connect();
  
  // Extract dbName from URI if possible, otherwise default to 'autoclaw'
  let dbName = 'autoclaw';
  try {
    const urlObj = new URL(url);
    const pathName = urlObj.pathname.slice(1);
    if (pathName) {
      dbName = pathName;
    }
  } catch (e) {
    // Ignore URL parsing errors
  }

  db = client.db(dbName);
  const dbNameFinal = db.databaseName;
  console.log(`Connected to MongoDB. Target Database: ${dbNameFinal}`);
};

export const getDb = () => db;

// Basic abstractions
export const getMemoryCollection = (): Collection => db.collection('memory');
export const getHistoryCollection = (): Collection => db.collection('history');
export const getJournalCollection = (): Collection => db.collection('journal');
export const getGymCollection = (): Collection => db.collection('gym');
export const getFinanceCollection = (): Collection => db.collection('finance');
export const getHabitCollection = (): Collection => db.collection('habit');
export const getStructuredMemoryCollection = (): Collection => db.collection('structured_memory');
export const getRemindersCollection = (): Collection => db.collection('reminders');
export const getFinanceCategoriesCollection = (): Collection => db.collection('finance_categories');
export const getFinanceBusinessesCollection = (): Collection => db.collection('finance_businesses');
export const getGymExercisesCollection = (): Collection => db.collection('gym_exercises');
export const getPendingConfirmationsCollection = (): Collection => db.collection('pending_confirmations');
export const getTodoCollection = (): Collection => db.collection('todo');

export const getDistinctExercises = async (): Promise<string[]> => {
  return await getGymExercisesCollection().distinct('name');
};

export const getDistinctFinanceCategories = async (): Promise<string[]> => {
  return await getFinanceCategoriesCollection().distinct('name');
};

export const normalizeLookupText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

export const tokenizeLookupText = (value: string): string[] =>
  normalizeLookupText(value)
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);

export const normalizeKeywordList = (values: string[] = []): string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeLookupText(value);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen];
};

export const toObjectId = (value: string): ObjectId => new ObjectId(value);
