import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const DAY = 86400000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function openDemand(path, topics, now = Date.now) {
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE IF NOT EXISTS votes (
    topic TEXT NOT NULL, voter_hash TEXT NOT NULL, voted_at INTEGER NOT NULL,
    PRIMARY KEY (topic, voter_hash)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS votes_time ON votes(voted_at);`)
  const insert = db.prepare(`INSERT INTO votes (topic, voter_hash, voted_at) VALUES (?, ?, ?)
    ON CONFLICT(topic, voter_hash) DO UPDATE SET voted_at=excluded.voted_at WHERE votes.voted_at <= ?`)
  const get = db.prepare(`SELECT topic, COUNT(*) AS count FROM votes WHERE voted_at > ?
    GROUP BY topic HAVING COUNT(*) >= 5 ORDER BY count DESC, topic ASC`)
  const remove = db.prepare('DELETE FROM votes WHERE voted_at <= ?')
  const allowed = new Set(topics.map(topic => topic.id))
  function record(topic, key) {
    const time = now()
    return { added: insert.run(topic, key, time, time - 30 * DAY).changes === 1 }
  }
  return {
    vote(topic, visitor) {
      if (!allowed.has(topic) || typeof visitor !== 'string' || !UUID.test(visitor)) return null
      const key = createHash('sha256').update(topic + ':' + visitor.toLowerCase()).digest('hex')
      return record(topic, key)
    },
    voteAuthenticated(topic, voterHash) {
      if (!allowed.has(topic) || typeof voterHash !== 'string' || !/^[0-9a-f]{64}$/.test(voterHash)) return null
      const key = createHash('sha256').update(topic + ':' + voterHash).digest('hex')
      return record(topic, 'authenticated:' + key)
    },
    rankings() { return { windowDays: 30, threshold: 5, rankings: get.all(now() - 30 * DAY).filter(row => allowed.has(row.topic)) } },
    prune() { remove.run(now() - 35 * DAY) },
    close() { db.close() }
  }
}
