-- Read-only schema snapshot. Runtime schema and migrations remain in server/store.js.
PRAGMA foreign_keys=ON;

CREATE TABLE assignments (reviewerId TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,outputId TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,position INTEGER NOT NULL,code TEXT NOT NULL, PRIMARY KEY(reviewerId,outputId));

CREATE TABLE benchmarks (id TEXT PRIMARY KEY, name TEXT NOT NULL, cases TEXT NOT NULL, created TEXT NOT NULL);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE models (id TEXT PRIMARY KEY, config TEXT NOT NULL);

CREATE TABLE outputs (id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, caseId TEXT NOT NULL, modelId TEXT NOT NULL, generationStatus TEXT NOT NULL, judgeStatus TEXT NOT NULL, content TEXT, latencyMs INTEGER, usage TEXT, autoScore TEXT, error TEXT, judgeError TEXT, attempts INTEGER NOT NULL DEFAULT 0, judgeMeta TEXT, UNIQUE(runId,caseId,modelId));

CREATE TABLE personnel (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,created TEXT NOT NULL,updated TEXT NOT NULL);

CREATE TABLE reviewers (id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL,created TEXT NOT NULL, personId TEXT REFERENCES personnel(id), active INTEGER NOT NULL DEFAULT 1, UNIQUE(runId,name));

CREATE TABLE reviews (reviewerId TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,outputId TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,scores TEXT NOT NULL,note TEXT NOT NULL,updated TEXT NOT NULL, PRIMARY KEY(reviewerId,outputId));

CREATE TABLE rubrics (runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, caseId TEXT NOT NULL, status TEXT NOT NULL, draft TEXT, rubric TEXT, error TEXT, meta TEXT, PRIMARY KEY(runId,caseId));

CREATE TABLE runs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, token TEXT UNIQUE NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL);
