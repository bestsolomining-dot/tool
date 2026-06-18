import sqlite3 from 'sqlite3';
import path from 'path';

export const db = new sqlite3.Database(path.join(process.cwd(), 'stats.db'));
