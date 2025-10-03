# Content Warehouse API

A professional RESTful API for managing multi-media content including transcripts, videos, books, articles, and courses.

## Features

- **Universal Content Management**: Handles all media types (video, audio, images, text, courses)
- **Advanced Search**: Full-text search across all content with filtering
- **Redis Caching**: High-performance caching for optimal response times
- **PostgreSQL Integration**: Robust database with comprehensive content metadata
- **Security**: Rate limiting, helmet protection, CORS support
- **Health Monitoring**: Built-in health checks and monitoring endpoints
- **Docker Ready**: Professional containerized deployment

## API Endpoints

### Core Endpoints
- `GET /api/health` - Health check and system status
- `GET /api/content` - Get all content with filtering and pagination
- `GET /api/content/:id` - Get specific content by ID
- `GET /api/search` - Universal search across all content types
- `GET /api/stats` - Warehouse statistics and metrics

### Specialized Endpoints
- `GET /api/content/recent` - Get recent content across all types
- `GET /api/content/by-author` - Get content by author name

## Environment Variables

```bash
NODE_ENV=production
PORT=3000
DB_HOST=content-postgres
DB_PORT=5432
DB_NAME=content_factory
DB_USER=content_admin
DB_PASSWORD=ContentFactory2024!SecureDB
REDIS_HOST=content-redis
REDIS_PORT=6379
REDIS_PASSWORD=ContentFactory2024!Redis
```

## Usage Examples

### Get all transcripts
```bash
curl "https://api.healthy-k9.com/api/content?type=transcript&limit=10"
```

### Search for content
```bash
curl "https://api.healthy-k9.com/api/search?q=marketing&type=video"
```

### Get warehouse statistics
```bash
curl "https://api.healthy-k9.com/api/stats"
```

## Deployment

This API is deployed using GitHub Container Registry with automated Docker image building.

### Production Deployment
```bash
docker-compose up -d
```

### Health Check
```bash
curl http://localhost:3000/api/health
```

## Architecture

- **Framework**: Express.js with TypeScript-style error handling
- **Database**: PostgreSQL with connection pooling
- **Cache**: Redis with automatic expiration
- **Security**: Helmet, CORS, rate limiting
- **Monitoring**: Health checks, structured logging
- **Performance**: Response compression, query optimization

## License

MIT License - Content Factory System