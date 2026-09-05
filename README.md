# Chatbot API Server

A Node.js RESTful API server for chatbot UI applications with PostgreSQL database integration, Prisma ORM, and Docker containerization.

## Features

- **Complete CRUD operations** for Users, Chats, Messages, and Models
- **PostgreSQL database** with Prisma ORM
- **Docker containerization** for easy deployment
- **CORS enabled** for frontend integration
- **Environment-based configuration**
- **Health check endpoints**
- **JWT-based authentication**

## Architecture

```mermaid
graph TD
    subgraph "Client Application"
        A[Chatbot UI]
    end

    subgraph "API Server (Node.js)"
        B[Routes]
        C[Middleware]
        D[Controllers]
        E[Services]
        F[Prisma ORM]
    end

    subgraph "Database"
        G[PostgreSQL]
    end

    A -- API Requests (HTTP/S) --> B
    B -- next() --> C
    C -- next() --> D
    D -- calls --> E
    E -- queries --> F
    F -- interacts with --> G
```

## Project Structure

```
chatbot-api-server/
├── src/
│   ├── controllers/          # Request handlers
│   │   ├── userController.js
│   │   ├── chatController.js
│   │   ├── messageController.js
│   │   └── modelController.js
│   ├── middleware/
│   │   └── auth.js
│   ├── routes/              # API routes
│   │   ├── userRoutes.js
│   │   ├── chatRoutes.js
│   │   ├── messageRoutes.js
│   │   └── modelRoutes.js
│   └── index.js            # Main server file
├── prisma/
│   └── schema.prisma       # Database schema
├── Dockerfile              # Container configuration
└── package.json           # Dependencies and scripts
```

## Quick Start

### Using Docker (Recommended)

1. Clone the repository and navigate to the project directory
2. Build the Docker image:
   ```bash
   docker build -t chatbot-api .
   ```
3. Run the Docker container:
   ```bash
   docker run -p 3000:3000 -e DATABASE_URL="postgresql://user:password@host.docker.internal:5432/mydb" chatbot-api
   ```

The API will be available at `http://localhost:3000`

### Manual Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```
3. Set up the database:
   ```bash
   npx prisma migrate dev --name init
   ```
4. Seed the database (optional, for development/testing):
   ```bash
   npm run db:seed
   ```
5. Format the code:
   ```bash
   npm run format
   ```
6. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `CORS_ORIGIN` | CORS allowed origins | * |

## API Endpoints

### Users
- `POST /users` - Create a new user
- `GET /users/:id` - Get user by ID

### Models
- `POST /models` - Create a new model
- `GET /models` - Get all models
- `GET /models/:id` - Get model by ID
- `PUT /models/:id` - Update model

### Chats
- `POST /chats` - Create a new chat
- `GET /chats` - Get all chats for the authenticated user
- `GET /chats/:id` - Get chat by ID
- `PUT /chats/:id` - Update chat
- `DELETE /chats/:id` - Delete chat

### Messages
- `POST /chats/:id/messages` - Create a new message in a chat
- `GET /chats/:id/messages` - Get all messages in a chat
- `GET /chats/:id/messages/:messageId` - Get message by ID
- `PUT /chats/:id/messages/:messageId` - Update message
- `DELETE /chats/:id/messages/:messageId` - Delete message

### Health Check
- `GET /health` - Server health status (NOT SUPPORTED YET)

## API Examples

To test the API, you will need a JWT token. You can create one for testing purposes at [jwt.io](https://jwt.io/). The token should contain a `userId` field.

### Create a User
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{"username": "john_doe", "email": "john@example.com", "firstName": "John", "lastName": "Doe"}'
```

### Create a Model
```bash
curl -X POST http://localhost:3000/models \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{"name": "GPT-4", "description": "OpenAI GPT-4 model", "modelId": "gpt-4"}'
```

### Create a Chat
```bash
curl -X POST http://localhost:3000/chats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{"title": "My First Chat", "modelId": 1, "summary": "A brief summary of the chat"}'
```

### Update a Chat
```bash
curl -X PUT http://localhost:3000/chats/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{"title": "Updated Chat Title", "summary": "A new summary for the chat"}'
```

### Send a Message
```bash
curl -X POST http://localhost:3000/chats/1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt>" \
  -d '{"role": "user", "content": "Hello, how are you?"}'
```


## Database Schema

The application uses the following main entities:

- **User**: Stores user information (username, email, etc.)
- **Model**: Defines available AI models
- **Chat**: Represents conversation sessions
- **Message**: Individual messages in conversations

All entities are properly related with foreign keys and include timestamps for creation and updates.

## Development

### Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with auto-reload
- `npx prisma migrate dev` - Run database migrations
- `npx prisma studio` - Open Prisma Studio

### Database Management

```bash
# Create a new migration
npx prisma migrate dev --name your_migration_name

# Reset database (development only)
npx prisma migrate reset

# View database in browser
npx prisma studio
```

## Deployment

### Docker Deployment

1. Build the image:
   ```bash
   docker build -t chatbot-api .
   ```

2. Run the container:
   ```bash
   docker run -p 3000:3000 -e DATABASE_URL="postgresql://user:password@host.docker.internal:5432/mydb" chatbot-api
   ```

### Production Considerations

- Use strong passwords for database credentials
- Configure proper CORS origins for security
- Set up SSL/TLS termination with a reverse proxy
- Monitor logs and set up log rotation
- Configure database backups
- Use environment-specific configuration files

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Quality Gates

```bash
npm run lint          # ESLint (flat config)
npm run lint:fix      # auto-fix what is mechanically fixable
npm run format:check  # prettier, check only
npm run format        # prettier, write
npm run build         # tsc
npm test              # vitest, unit tests only
npm run test:ci       # vitest + coverage, writes junit.xml and coverage/
```

CI runs `lint` and `unit-test` from the shared `bouc-io/ci-templates` project.

- **Lint uses a warning ratchet.** ESLint *errors* always fail the build. Warnings are
  capped by `max_warnings` in `.gitlab-ci.yml`, currently **76** (76 no-explicit-any). When you
  clean some up, lower the number. Never raise it, and never silence a rule repo-wide to
  get green.
- **Formatting is enforced.** `format:check` gates, using prettier defaults with no config
  file.

Two things to know before you ever run a bulk reformat here:

- **Prettier needs two passes.** It breaks some method chains across lines on the first
  pass and collapses them back on the second, so a single
  `npm run format` can leave `format:check` failing.
- **Prettier can wrap a statement out from under an `eslint-disable-next-line`.** That is
  why the suppressions in this repo use block `/* eslint-disable rule */ ... /* eslint-enable rule */`
  pairs, which survive re-wrapping. Keep them that way.

## License

[Elastic License 2.0](./LICENSE) — source-available; not OSI open source.
