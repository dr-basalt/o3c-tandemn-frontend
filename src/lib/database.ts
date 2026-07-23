import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://choprahetarth:helloworld@demo-day.tjaxr2t.mongodb.net/iroh_o3c?retryWrites=true&w=majority&appName=demo-day';

interface CachedConnection {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

let cached: CachedConnection = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) {
    console.log('📊 Using cached MongoDB connection');
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    console.log('📊 Connecting to MongoDB...');
    console.log('  URI preview:', MONGODB_URI.substring(0, 50) + '...');
    console.log('  Database:', MONGODB_URI.match(/mongodb.net\/([^?]+)/)?.[1]);
    
    cached.promise = mongoose.connect(MONGODB_URI, opts);
  }

  try {
    cached.conn = await cached.promise;
    console.log('✅ MongoDB connected successfully');
    console.log('  Database name:', cached.conn.connection.db?.databaseName || 'unknown');
  } catch (e) {
    cached.promise = null;
    console.error('❌ MongoDB connection failed:', e);
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
