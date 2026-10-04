import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { pathToFileURL } from "node:url";

export type Post = {
  id: string;
  creatorId: string;
  categoryIds: string[];
  publishedAt: Date;
  active: boolean;
  embedding?: number[];
  likes: number;
  comments: number;
  saves: number;
  shares: number;
};

export type User = {
  followedCreatorIds: Set<string>;
  seenPostIds: Set<string>;
  interests: Map<string, number>;
  likedPostEmbeddings: number[][];
};

const weights = { interest: 0.4, engagement: 0.3, follow: 0.15, popularity: 0.1, recency: 0.05 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function similarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA && normB ? clamp(dot / Math.sqrt(normA * normB)) : 0;
}

export function recommend(posts: Post[], user: User, limit = 20, maxPerCreator = 2) {
  if (limit <= 0) return [];
  const ranked = posts
    .filter((post) => post.active && !user.seenPostIds.has(post.id) && Number.isFinite(post.publishedAt.getTime()))
    .map((post) => {
      const contentMatch = post.embedding && user.likedPostEmbeddings.length
        ? Math.max(...user.likedPostEmbeddings.map((liked) => similarity(post.embedding!, liked)))
        : 0;
      const categoryMatch = Math.max(0, ...post.categoryIds.map((id) => user.interests.get(id) ?? 0));
      const total = post.likes + post.comments + post.saves + post.shares;
      const ageDays = Math.max(0, (Date.now() - post.publishedAt.getTime()) / 86_400_000);
      const scores = {
        interest: clamp(Math.max(categoryMatch, contentMatch)),
        engagement: contentMatch,
        follow: user.followedCreatorIds.has(post.creatorId) ? 1 : 0,
        popularity: clamp(Math.log1p(total) / Math.log(1001)),
        recency: Math.exp(-ageDays / 14),
      };
      const score = Object.entries(weights).reduce(
        (sum, [key, weight]) => sum + scores[key as keyof typeof scores] * weight,
        0,
      );
      const labels: Record<keyof typeof scores, string> = {
        interest: "Matches your interests",
        engagement: "Similar to posts you engaged with",
        follow: "From a creator you follow",
        popularity: "Popular with other users",
        recency: "Recently published",
      };
      const reasons = Object.entries(scores)
        .filter(([, value]) => value >= 0.5)
        .map(([key]) => labels[key as keyof typeof scores]);
      return { post, score, reasons, scores };
    })
    .sort((a, b) => b.score - a.score);

  const counts = new Map<string, number>();
  const feed = [];
  for (const item of ranked) {
    const count = counts.get(item.post.creatorId) ?? 0;
    if (count >= maxPerCreator) continue;
    counts.set(item.post.creatorId, count + 1);
    feed.push(item);
    if (feed.length >= limit) break;
  }
  return feed;
}

const privateField = /password|secret|token|credential|api.?key|email|phone|address|first.?name|last.?name|username/i;
function redact(value: unknown, key = ""): unknown {
  if (privateField.test(key)) return "[REDACTED]";
  if (value instanceof Date) return "<date>";
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  if (typeof value === "string" && value.length > 160) return `${value.slice(0, 157)}...`;
  return value;
}

async function discoverDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI in your .env file.");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const result = await client.db("admin").admin().listDatabases({ nameOnly: true });
    const databases = result.databases.filter(({ name }) => !["admin", "config", "local"].includes(name));
    if (databases.length === 0) {
      console.log("No application databases are visible to this account.");
      return;
    }

    for (const { name } of databases) {
      const db = client.db(name);
      console.log(`\nDatabase: ${name}`);
      for (const { name: collection } of await db.listCollections({}, { nameOnly: true }).toArray()) {
        const samples = await db.collection(collection).find({}).limit(2).toArray();
        console.log(`\n${collection} (${samples.length} sample document(s)):`);
        for (const sample of samples) console.log(JSON.stringify(redact(sample), null, 2));
      }
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  discoverDatabase().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Database discovery failed.";
    console.error(message);
    if (message.toLowerCase().includes("listdatabases")) {
      console.error("This MongoDB user may not have permission to list databases.");
    }
    process.exitCode = 1;
  });
}
