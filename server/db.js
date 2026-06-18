// This module acts as a singleton for the database connection.
// The 'db' instance is initialized and exported from index.js
// to ensure the entire application uses the same connection.
export let db = null;

export function setDb(dbInstance) {
  db = dbInstance;
}
