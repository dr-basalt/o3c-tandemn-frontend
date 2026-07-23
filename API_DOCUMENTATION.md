# O3C API Documentation

## Overview

O3C provides a unified API for accessing 5 core AI models with token-based pricing. Users are charged per million tokens consumed, with separate pricing for input and output tokens.

## Authentication

All API calls require authentication using an API key in the Authorization header:

```bash
Authorization: Bearer YOUR_API_KEY
```

## Base URL

```
https://api.o3c.com/v1
```

## Core Models

| Model | Provider | Input Price/1M | Output Price/1M | Context Length |
|-------|----------|----------------|-----------------|----------------|
| `claude-3-5-sonnet` | Anthropic | $3.00 | $15.00 | 200,000 |
| `gpt-4o` | OpenAI | $2.50 | $10.00 | 128,000 |
| `gemini-1.5-pro` | Google | $1.25 | $5.00 | 2,097,152 |
| `llama-3.1-405b` | Meta | $2.70 | $2.70 | 32,768 |
| `mixtral-8x22b` | Mistral AI | $0.90 | $0.90 | 65,536 |

---

## Endpoints

### 1. Chat Completions

**Endpoint:** `POST /v1/chat/completions`

Generate text completions using AI models.

#### Request

```bash
curl -X POST https://api.o3c.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 1024,
    "temperature": 1
  }'
```

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Model ID from the supported models list |
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `max_tokens` | integer | No | Maximum tokens to generate (default: 1024) |
| `temperature` | float | No | Sampling temperature 0-2 (default: 1) |
| `stream` | boolean | No | Stream response (not supported in mock) |

#### Response

```json
{
  "id": "chatcmpl-1699473200123",
  "object": "chat.completion",
  "created": 1699473200,
  "model": "claude-3-5-sonnet",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm Claude 3.5 Sonnet by Anthropic..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 45,
    "total_tokens": 57
  },
  "billing": {
    "credits_charged": 0.0084,
    "credits_remaining": 24.9916,
    "input_cost": 0.0001,
    "output_cost": 0.0068,
    "pricing": {
      "input_price_per_1m_tokens": 3.00,
      "output_price_per_1m_tokens": 15.00
    }
  },
  "model_info": {
    "provider": "Anthropic",
    "context_length": 200000,
    "capabilities": ["text", "reasoning", "analysis", "coding"],
    "max_tokens": 8192
  }
}
```

#### Error Responses

**401 Unauthorized:**
```json
{
  "error": "Invalid API key"
}
```

**402 Payment Required:**
```json
{
  "error": "Insufficient credits. Required: $0.0084, Available: $0.0050",
  "required_credits": 0.0084,
  "available_credits": 0.0050,
  "token_breakdown": {
    "input_tokens": 12,
    "output_tokens": 45,
    "input_price_per_1m": 3.00,
    "output_price_per_1m": 15.00,
    "total_cost": 0.0084
  }
}
```

---

### 2. List Models

**Endpoint:** `GET /v1/models`

Get all available models and their capabilities.

#### Request

```bash
curl https://api.o3c.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Response

```json
{
  "data": [
    {
      "id": "claude-3-5-sonnet",
      "name": "Claude 3.5 Sonnet",
      "provider": "Anthropic",
      "description": "Most intelligent model with excellent reasoning, writing, and analysis capabilities",
      "context_length": 200000,
      "input_price_per_1m": 3.00,
      "output_price_per_1m": 15.00,
      "capabilities": ["text", "reasoning", "analysis", "coding"],
      "max_tokens": 8192,
      "is_available": true
    }
  ],
  "total": 5
}
```

---

### 3. Get Pricing

**Endpoint:** `GET /v1/pricing`

Get pricing information for models.

#### Request

```bash
# Get all model pricing
curl https://api.o3c.com/v1/pricing \
  -H "Authorization: Bearer YOUR_API_KEY"

# Get specific model pricing
curl https://api.o3c.com/v1/pricing?model=claude-3-5-sonnet \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Response

```json
{
  "data": [
    {
      "id": "claude-3-5-sonnet",
      "name": "Claude 3.5 Sonnet",
      "provider": "Anthropic",
      "input_price_per_1m": 3.00,
      "output_price_per_1m": 15.00,
      "context_length": 200000
    }
  ],
  "total": 5
}
```

---

### 4. Calculate Pricing

**Endpoint:** `POST /v1/pricing/calculate`

Calculate cost for specific token usage.

#### Request

```bash
curl -X POST https://api.o3c.com/v1/pricing/calculate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "claude-3-5-sonnet",
    "input_tokens": 1000,
    "output_tokens": 500
  }'
```

#### Response

```json
{
  "data": {
    "model_id": "claude-3-5-sonnet",
    "input_tokens": 1000,
    "output_tokens": 500,
    "total_tokens": 1500,
    "input_cost": 0.0030,
    "output_cost": 0.0075,
    "total_cost": 0.0105,
    "pricing": {
      "input_price_per_1m": 3.00,
      "output_price_per_1m": 15.00
    }
  }
}
```

---

### 5. Check Balance

**Endpoint:** `GET /v1/balance`

Get current credit balance and usage statistics.

#### Request

```bash
curl https://api.o3c.com/v1/balance \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Response

```json
{
  "data": {
    "balance": 24.9916,
    "currency": "USD",
    "monthly_usage": {
      "spent": 5.2341,
      "api_calls": 47,
      "period": "2024-01-01 to 2024-01-15"
    },
    "recent_transactions": [
      {
        "id": "txn_1699473200_abc123",
        "type": "usage_charge",
        "amount": -0.0084,
        "description": "Claude 3.5 Sonnet - 57 tokens",
        "created_at": "2024-01-15T10:30:00Z",
        "metadata": {
          "model": "claude-3-5-sonnet",
          "input_tokens": 12,
          "output_tokens": 45,
          "total_tokens": 57
        }
      }
    ]
  }
}
```

---

## Real Backend Implementation Requirements

### 1. **Database Schema**

You'll need these core tables:

#### Users Table
```sql
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  balance DECIMAL(10,4) DEFAULT 0.0000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### API Keys Table
```sql
CREATE TABLE api_keys (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) UNIQUE NOT NULL,  -- Store hash, not raw key
  is_active BOOLEAN DEFAULT true,
  last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### Transactions Table
```sql
CREATE TABLE transactions (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  type ENUM('credit_purchase', 'usage_charge', 'bonus_credit') NOT NULL,
  amount DECIMAL(10,4) NOT NULL,
  description TEXT,
  model_id VARCHAR(50),
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 2. **Environment Variables**

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# OpenAI Integration (for actual AI responses)
OPENAI_API_KEY=sk-your-openai-key

# Anthropic Integration
ANTHROPIC_API_KEY=sk-ant-your-key

# Google Integration
GOOGLE_AI_API_KEY=your-google-key

# Meta/Llama Integration (via Together AI, Replicate, etc.)
TOGETHER_API_KEY=your-together-key

# Mistral AI Integration
MISTRAL_API_KEY=your-mistral-key

# JWT Secret for API keys
JWT_SECRET=your-jwt-secret

# Rate Limiting
REDIS_URL=redis://localhost:6379
```

### 3. **Core Implementation Files**

#### Model Configuration (`/config/models.js`)
```javascript
export const MODELS = {
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    inputPrice: 3.00,
    outputPrice: 15.00,
    contextLength: 200000
  },
  // ... other models
};
```

#### Rate Limiting Middleware (`/middleware/rateLimit.js`)
```javascript
// Implement rate limiting per API key
// Suggested: 100 requests/minute per key
```

#### Authentication Middleware (`/middleware/auth.js`)
```javascript
// Validate API keys against database
// Update last_used timestamp
```

#### Balance Management (`/services/billing.js`)
```javascript
// Check balance before processing
// Deduct credits after successful completion
// Handle concurrent request edge cases with database transactions
```

### 4. **AI Provider Integration**

You'll need to implement actual API calls to:

1. **Anthropic Claude API** - for Claude models
2. **OpenAI API** - for GPT-4o
3. **Google Gemini API** - for Gemini models
4. **Together AI or Replicate** - for Llama models
5. **Mistral AI API** - for Mixtral models

### 5. **Production Considerations**

- **Rate Limiting**: Implement per-key rate limiting
- **Monitoring**: Track usage, errors, and performance
- **Logging**: Comprehensive request/response logging
- **Caching**: Cache model responses where appropriate
- **Security**: Input validation, SQL injection protection
- **Scaling**: Queue system for high-throughput scenarios
- **Billing**: Automated credit purchases, payment webhooks

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid API key |
| 402 | Payment Required - Insufficient credits |
| 404 | Not Found - Model not found |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

---

## Rate Limits

- **100 requests per minute** per API key
- **1000 requests per day** for free tier
- **Unlimited** for paid tiers

## Support

For API support, contact: api-support@o3c.com