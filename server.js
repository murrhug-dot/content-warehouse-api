const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'content-postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'content_factory',
  user: process.env.DB_USER || 'content_admin',
  password: process.env.DB_PASSWORD || 'ContentFactory2024!SecureDB',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Redis client for caching
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'content-redis',
    port: process.env.REDIS_PORT || 6379,
  },
  password: process.env.REDIS_PASSWORD || 'ContentFactory2024!Redis'
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

redisClient.connect();

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT 1');
    await redisClient.ping();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      redis: 'connected',
      version: '1.0.0',
      warehouse: 'content-warehouse-api'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Get all content with filtering (UNIVERSAL ENDPOINT)
app.get('/api/content', async (req, res) => {
  try {
    const { type, format, page = 1, limit = 50, author } = req.query;
    const offset = (page - 1) * limit;

    // Build cache key
    const cacheKey = `content:${JSON.stringify(req.query)}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Build dynamic query
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (type) {
      whereConditions.push(`(source_type = $${paramCount} OR media_type = $${paramCount})`);
      queryParams.push(type);
      paramCount++;
    }

    if (format) {
      whereConditions.push(`file_format = $${paramCount}`);
      queryParams.push(format);
      paramCount++;
    }

    if (author) {
      whereConditions.push(`author_name ILIKE $${paramCount}`);
      queryParams.push(`%${author}%`);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM content ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const dataQuery = `
      SELECT
        id, title, video_id, created_date, ai_processing_status,
        r2_source_path, word_count, ai_topics, ai_sentiment,
        source_type, media_type, file_format, file_size, duration_seconds,
        dimensions, thumbnail_url, page_count, author_name,
        resolution, course_level, tags
      FROM content
      ${whereClause}
      ORDER BY created_date DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);
    const result = await pool.query(dataQuery, queryParams);

    const response = {
      content: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      filters: { type, format, author }
    };

    // Cache for 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    console.error('Error fetching content:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific content by ID
app.get('/api/content/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cacheKey = `content:${id}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const result = await pool.query('SELECT * FROM content WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = result.rows[0];

    // Cache for 10 minutes
    await redisClient.setEx(cacheKey, 600, JSON.stringify(content));

    res.json(content);
  } catch (error) {
    console.error('Error fetching content:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Universal search across ALL content types
app.get('/api/search', async (req, res) => {
  try {
    const { q, type, page = 1, limit = 20 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const offset = (page - 1) * limit;

    const cacheKey = `search:${q}:${type}:page:${page}:limit:${limit}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let typeCondition = '';
    let queryParams = [`%${q}%`, limit, offset];

    if (type) {
      typeCondition = 'AND (source_type = $4 OR media_type = $4)';
      queryParams.push(type);
    }

    const result = await pool.query(`
      SELECT
        id, title, video_id, created_date, ai_processing_status,
        r2_source_path, ai_topics, ai_sentiment, source_type, media_type,
        file_format, author_name, thumbnail_url
      FROM content
      WHERE (
        title ILIKE $1
        OR content_text ILIKE $1
        OR author_name ILIKE $1
        OR ai_topics::text ILIKE $1
      ) ${typeCondition}
      ORDER BY created_date DESC
      LIMIT $2 OFFSET $3
    `, queryParams);

    const response = {
      query: q,
      type: type || 'all',
      results: result.rows,
      count: result.rows.length
    };

    // Cache for 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    console.error('Error searching content:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get warehouse statistics
app.get('/api/stats', async (req, res) => {
  try {
    const cacheKey = 'stats:warehouse';
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Get comprehensive statistics
    const queries = await Promise.all([
      pool.query('SELECT COUNT(*) FROM content'),
      pool.query('SELECT source_type, COUNT(*) as count FROM content GROUP BY source_type'),
      pool.query('SELECT media_type, COUNT(*) as count FROM content WHERE media_type IS NOT NULL GROUP BY media_type'),
      pool.query('SELECT COUNT(*) FROM content WHERE ai_processing_status = $1', ['completed']),
      pool.query('SELECT COUNT(*) FROM content WHERE ai_processing_status = $1', ['pending']),
      pool.query('SELECT AVG(word_count) FROM content WHERE word_count IS NOT NULL'),
      pool.query('SELECT created_date FROM content ORDER BY created_date DESC LIMIT 1')
    ]);

    const sourceTypeCounts = {};
    queries[1].rows.forEach(row => {
      sourceTypeCounts[row.source_type] = parseInt(row.count);
    });

    const mediaTypeCounts = {};
    queries[2].rows.forEach(row => {
      mediaTypeCounts[row.media_type] = parseInt(row.count);
    });

    const stats = {
      total_content: parseInt(queries[0].rows[0].count),
      content_by_source_type: sourceTypeCounts,
      content_by_media_type: mediaTypeCounts,
      processed_content: parseInt(queries[3].rows[0].count),
      pending_content: parseInt(queries[4].rows[0].count),
      average_word_count: Math.round(parseFloat(queries[5].rows[0].avg) || 0),
      latest_content: queries[6].rows[0]?.created_date || null,
      last_updated: new Date().toISOString()
    };

    // Cache for 2 minutes
    await redisClient.setEx(cacheKey, 120, JSON.stringify(stats));

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent content across all types
app.get('/api/content/recent', async (req, res) => {
  try {
    const { limit = 10, type } = req.query;

    let typeCondition = '';
    let queryParams = [limit];

    if (type) {
      typeCondition = 'WHERE (source_type = $2 OR media_type = $2)';
      queryParams.push(type);
    }

    const result = await pool.query(`
      SELECT
        id, title, video_id, created_date, ai_processing_status,
        r2_source_path, ai_topics, source_type, media_type, file_format,
        thumbnail_url, author_name
      FROM content
      ${typeCondition}
      ORDER BY created_date DESC
      LIMIT $1
    `, queryParams);

    res.json({
      recent_content: result.rows,
      count: result.rows.length,
      type: type || 'all'
    });
  } catch (error) {
    console.error('Error fetching recent content:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get content by author
app.get('/api/content/by-author', async (req, res) => {
  try {
    const { author } = req.query;

    if (!author) {
      return res.status(400).json({ error: 'Author parameter is required' });
    }

    const result = await pool.query(`
      SELECT
        id, title, video_id, created_date, ai_topics, ai_sentiment,
        source_type, media_type, file_format, author_name, thumbnail_url
      FROM content
      WHERE author_name ILIKE $1
      ORDER BY created_date DESC
    `, [`%${author}%`]);

    res.json({
      author,
      content: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching content by author:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Content Warehouse API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});