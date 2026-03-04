

Production-ready Node.js backend for the Target Setting PWA.

```
Routes → Controllers → Services → Database (Knex + PostgreSQL)
```

**Tech Stack:** Node.js 18+, Express 4, PostgreSQL 15+, Knex.js, JWT, bcrypt, Joi validation


Server starts at `http://localhost:3001`. Health check: `GET /health`



## Azure AD SSO

SSO is **configurable but not required**. To enable:

1. Set `AUTH_MODE=dual` in `.env`
2. Fill in `AZURE_AD_*` variables
3. The middleware auto-detects token type


```

JWT stored in `localStorage` under `appasamy_token`.
